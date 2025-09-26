# Monotone

> ⚠️ **Work in Progress**: This project is currently under active development. The API may change and some features may not be fully implemented yet. Use with caution in production environments.

A MySQL connection pool that automatically routes queries between primary and replica databases using GTID-based synchronization.

## Overview

Monotone provides intelligent query routing for MySQL master-replica setups, ensuring read consistency by automatically checking replica synchronization before routing read queries. Write operations always go to the primary database, while read operations are intelligently routed to replicas that have caught up with the primary.

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
npm install monotone
```

## Quick Start

```typescript
import { createMonotonePool } from 'monotone';

const pool = createMonotonePool({
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
  gtidProvider: {
    async getGTID() {
      // Return current GTID for replica synchronization
      const [rows] = await primary.query(
        'SELECT @@GLOBAL.GTID_EXECUTED as gtid',
      );
      return rows[0]?.gtid;
    },
  },
});

// Use like any MySQL pool
const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [123]);
```

## Disabled Mode

For simpler setups where you don't need GTID-based synchronization, you can enable disabled mode:

```typescript
const pool = createMonotonePool({
  primary: primaryConfig,
  replicas: [replicaConfig],
  gtidProvider: myProvider,
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
│   Application   │───▶│  Monotone Pool  │───▶│   Primary MySQL │
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

- **Monotone Pool**: Acts as a virtual pool, abstracting multiple MySQL pools behind a single interface
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

1. **GTID Retrieval**: Call `gtidProvider.getGTID()` (application-controlled, typically fast)
2. **Synchronization Check**: Wait for replica to catch up to retrieved GTID (bounded by timeout)
3. **Query Execution**: Route to synchronized replica or fallback to primary
4. **Result Return**: Return query results to application

#### Performance Characteristics

- **GTID Retrieval**: Depends on application implementation (Redis: ~1ms, Database: ~5-10ms)
- **Synchronization Wait**: Bounded by `timeout` setting (default: 50ms max)
- **Total Read Overhead**: GTID retrieval + synchronization wait (typically < 60ms)
- **Fallback Performance**: Immediate fallback to primary when timeout exceeded

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

Monotone includes comprehensive error handling:

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

Currently, Monotone only uses the first replica in the `replicas` array.

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
const pool = createMonotonePool({
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
  gtidProvider: myProvider,
});
```

### MySQL Configuration Requirements

Monotone requires **MySQL 5.7 or later** to function properly. This is because the library relies on GTID (Global Transaction Identifier) functionality and the `WAIT_FOR_EXECUTED_GTID_SET` function, which were introduced in MySQL 5.7.

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
