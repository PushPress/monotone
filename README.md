# Virtual Pool

> ⚠️ **Work in Progress**: This project is currently under active development. The API may change and some features may not be fully implemented yet. Use with caution in production environments.

A MySQL connection pool that automatically routes queries between primary and replica databases using GTID-based synchronization.

## Overview

Virtual Pool provides intelligent query routing for MySQL master-replica setups, ensuring read consistency by automatically checking replica synchronization before routing read queries. Write operations always go to the primary database, while read operations are intelligently routed to replicas that have caught up with the primary.

## Features

- **Automatic Query Routing**: Write queries → Primary, Read queries → Synchronized replicas
- **GTID-Based Synchronization**: Uses MySQL GTIDs to ensure replica consistency
- **Zero-Overhead Fallback**: Falls back to primary when replicas are unavailable
- **Customizable GTID Strategy**: Control how GTIDs are retrieved and stored
- **Disabled Mode**: Route reads to replicas without GTID synchronization for simpler setups
- **Comprehensive Logging**: Detailed logging for debugging and monitoring
- **TypeScript Support**: Full TypeScript definitions included

## Installation

```bash
npm install virtual-pool
```

## Quick Start

```typescript
import { createVirtualPool } from 'virtual-pool';

const pool = createVirtualPool({
  primary: {
    host: 'primary-db.example.com',
    user: 'user',
    password: 'password',
    database: 'mydb',
  },
  replicas: [
    {
      host: 'replica1.example.com',
      user: 'user',
      password: 'password',
      database: 'mydb',
    },
  ],
});

// Use like any MySQL pool
const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [123]);
```

## Disabled Mode

For simpler setups where you don't need GTID-based synchronization, you can enable disabled mode:

```typescript
const pool = createVirtualPool({
  primary: primaryConfig,
  replicas: [replicaConfig],
  disabled: true, // Enable disabled mode
});

// In disabled mode:
// - Read queries → First replica (no GTID synchronization)
// - Write queries → Primary (unchanged)
// - No GTID capture or synchronization overhead
```

**When to use disabled mode:**
- Development environments
- Simple read/write splitting without strict consistency requirements
- When you want to avoid GTID synchronization overhead
- Testing scenarios where replica lag is acceptable

## Architecture

### Core Components

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Application   │───▶│  Virtual Pool   │───▶│   Primary MySQL │
│                 │    │ (Virtual Pool)  │    │      Pool       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │ Query Router     │
                       │                  │
                       │ • Write → Primary│
                       │ • Read → Selector│
                       └──────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │ GTID Replica     │
                       │ Selector         │
                       │                  │
                       │ • Check sync     │
                       │ • Route to replica│
                       │ • Fallback logic │
                       └──────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │  Replica MySQL  │
                       │      Pool       │
                       └─────────────────┘
```

#### Component Relationships

- **Virtual Pool**: Acts as a virtual pool, abstracting multiple MySQL pools behind a single interface
- **Primary MySQL Pool**: Existing mysql2 connection pool for primary database
- **Replica MySQL Pool**: Existing mysql2 connection pool for replica database
- **Query Router**: Intercepts queries and routes based on operation type
- **GTID Replica Selector**: Manages replica synchronization and selection

## Query Routing Logic

### Write Operations

- **Always routed to primary database**
- Detected using SQL keyword matching (INSERT, UPDATE, DELETE, etc.)
- GTID capture occurs after successful writes (if configured)

### Read Operations

- **Routed to replicas based on application-controlled GTID synchronization**
- The application determines what GTID is considered "synchronized" via the `GTIDProvider.getGTID()` method
- **Minimal overhead**: Only queries the application's GTID source (not the database) for synchronization decisions
- **Bounded latency**: Additional read overhead is limited by the configured timeout (default: 0.05s). Single milisecond latency when the database is in the same vpc/az and the replica is synchronized
- **Smart fallback**: Falls back to primary if:
  - No replicas configured
  - Replica synchronization timeout (bounded by `timeout` setting)
  - GTID unavailable from application source
  - Replica connection errors

#### Read Operation Flow

1. **GTID Retrieval**: Query primary database for current GTID (typically fast)
2. **Synchronization Check**: Wait for replica to catch up to retrieved GTID (bounded by timeout)
3. **Query Execution**: Route to synchronized replica or fallback to primary
4. **Result Return**: Return query results to application

#### Performance Characteristics

- **GTID Retrieval**: Query primary database (~5-10ms)
- **Synchronization Wait**: Bounded by `timeout` setting (default: 50ms max)
- **Total Read Overhead**: GTID retrieval + synchronization wait (typically < 60ms)
- **Fallback Performance**: Immediate fallback to primary when timeout exceeded

## GTID Context Setup

Virtual Pool includes a GTID context system that allows you to share GTID values across async operations within a request context. This is particularly useful for web applications where you want to maintain GTID consistency across multiple database operations within a single request.

### Express Setup

```typescript
import express from 'express';
import { createGtidContext } from 'virtual-pool';

const app = express();

// Middleware to create GTID context for each request
app.use((req, res, next) => {
  createGtidContext();
  next();
});

// Your route handlers can now use GTID context
app.get('/api/users/:id', async (req, res) => {
  // GTID context is automatically available for all database operations
  // within this request handler and any nested async operations
  const user = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  res.json(user);
});
```

### Fastify Setup

```typescript
import Fastify from 'fastify';
import { createGtidContext } from 'virtual-pool';

const fastify = Fastify();

// Plugin to create GTID context for each request
fastify.register(async function (fastify) {
  fastify.addHook('preHandler', async (request, reply) => {
    createGtidContext();
  });
});

// Your route handlers can now use GTID context
fastify.get('/api/users/:id', async (request, reply) => {
  // GTID context is automatically available for all database operations
  // within this request handler and any nested async operations
  const user = await pool.query('SELECT * FROM users WHERE id = ?', [request.params.id]);
  return user;
});
```

### Manual Context Management

You can also manually manage GTID context for more control:

```typescript
import { createGtidContext } from 'virtual-pool';

// Create context with initial GTID
const context = createGtidContext('custom-gtid-123');

// Read current context
const currentContext = context.read();
console.log(currentContext?.gtid); // 'custom-gtid-123'

// Update context GTID
context.set('updated-gtid-456');

// Context persists through async operations
const result = await someAsyncOperation();
const finalContext = context.read();
console.log(finalContext?.gtid); // 'updated-gtid-456'
```

You can also use the lower-level functions directly:

```typescript
import { init, read, set } from 'virtual-pool';

// Initialize context with a specific GTID
init('custom-gtid-123');

// Read current context
const context = read();
console.log(context?.gtid); // 'custom-gtid-123'

// Update context GTID
set('updated-gtid-456');

// Context persists through async operations
const result = await someAsyncOperation();
const finalContext = read();
console.log(finalContext?.gtid); // 'updated-gtid-456'
```

## Advanced Usage

## Performance Considerations

### Write Operations

- **Minimal overhead**: Only GTID capture if `onWriteGTID` is provided
- **No synchronization delays**: Writes go directly to primary

### Read Operations

- **Application-controlled GTID**: Retrieval speed depends on implementation (Redis: ~1ms, Database: ~5-10ms)
- **Bounded synchronization wait**: Limited by `timeout` setting (default: 50ms max)
- **Predictable overhead**: Total read latency = GTID retrieval + sync wait (typically < 60ms)
- **Smart fallback**: Immediate fallback to primary when timeout exceeded

## Error Handling

Virtual Pool includes comprehensive error handling:

- **Connection failures**: Automatic fallback to primary
- **GTID errors**: Graceful degradation with logging
- **Timeout handling**: Configurable synchronization timeouts
- **Logging**: Detailed error information for debugging

## Limitations

1. **Single Replica**: Currently only uses the first replica (rotation not implemented)
2. **GTID Dependency**: Requires MySQL GTID mode enabled
3. **Write Capture**: `onWriteGTID` only captures writes through this pool
4. **Connection Pooling**: Uses mysql2 connection pooling internally

## Roadmap & TODOs

### Multiple Replica Support

Currently, Virtual Pool only uses the first replica in the `replicas` array.

#### Replica Health Monitoring

- **Connection Health**: Monitor replica connection status
- **Replication Lag**: Track replication delay per replica
- **Query Performance**: Monitor query response times
- **Automatic Failover**: Remove unhealthy replicas from rotation

#### Load Balancing Features

- **Connection Pooling**: Separate connection pools per replica
- **Circuit Breaker**: Temporarily disable failing replicas
- **Graceful Degradation**: Fallback to fewer replicas when needed
- **Metrics Collection**: Detailed metrics for replica performance

#### Example Usage (Planned)

```typescript
const pool = createVirtualPool({
  primary: primaryConfig,
  replicas: [
    { host: 'replica1.example.com', weight: 1 },
    { host: 'replica2.example.com', weight: 2 },
    { host: 'replica3.example.com', weight: 1 },
  ],
  replicaSelection: {
    strategy: 'weighted',
    weights: {
      'replica1.example.com': 1,
      'replica2.example.com': 2, // 2x traffic
      'replica3.example.com': 1,
    },
    healthCheckInterval: 30000, // 30 seconds
  },
});
```

### MySQL Configuration Requirements

Virtual Pool requires **MySQL 5.7 or later** to function properly. This is because the library relies on GTID (Global Transaction Identifier) functionality and the `WAIT_FOR_EXECUTED_GTID_SET` function, which were introduced in MySQL 5.7.

The following settings must be enabled on both your primary and replica MySQL servers:

#### Primary Database Configuration

Add these settings to your MySQL configuration file (`my.cnf` or `my.ini`):

```ini
[mysqld]
# Enable GTID mode (required)
gtid_mode = ON
enforce_gtid_consistency = ON
```

#### Replica Database Configuration

```ini
[mysqld]
# Enable GTID mode (required)
gtid_mode = ON
enforce_gtid_consistency = ON

```
