import { describe, it, expect, beforeEach } from 'vitest';
import { MapGTIDProvider } from '../src/gtid-providers/map-gtid-provider';

describe('MapGTIDProvider', () => {
  let provider: MapGTIDProvider;

  beforeEach(() => {
    provider = new MapGTIDProvider();
  });

  describe('basic functionality', () => {
    it('should store and retrieve GTIDs', async () => {
      await provider.onWriteGTID('gtid-123', ['mydb.users']);
      
      const result = await provider.getGTID(['mydb.users']);
      expect(result).toBe('gtid-123');
    });

    it('should return undefined when no GTID stored', async () => {
      const result = await provider.getGTID(['mydb.users']);
      expect(result).toBeUndefined();
    });

    it('should return undefined when no tables provided', async () => {
      const result = await provider.getGTID();
      expect(result).toBeUndefined();
    });
  });

  describe('multiple tables', () => {
    it('should store GTID for multiple tables', async () => {
      await provider.onWriteGTID('gtid-456', ['mydb.users', 'mydb.orders']);
      
      expect(await provider.getGTID(['mydb.users'])).toBe('gtid-456');
      expect(await provider.getGTID(['mydb.orders'])).toBe('gtid-456');
    });

    it('should return GTID for first matching table', async () => {
      await provider.onWriteGTID('gtid-users', ['mydb.users']);
      await provider.onWriteGTID('gtid-orders', ['mydb.orders']);
      
      const result = await provider.getGTID(['mydb.users', 'mydb.orders']);
      expect(result).toBe('gtid-users');
    });
  });

  describe('updates and overrides', () => {
    it('should update existing GTID for table', async () => {
      await provider.onWriteGTID('gtid-123', ['mydb.users']);
      await provider.onWriteGTID('gtid-456', ['mydb.users']);
      
      const result = await provider.getGTID(['mydb.users']);
      expect(result).toBe('gtid-456');
    });

    it('should not store GTID when no tables provided', async () => {
      await provider.onWriteGTID('gtid-123');
      
      expect(provider.size()).toBe(0);
    });
  });

  describe('utility methods', () => {
    it('should track size correctly', async () => {
      expect(provider.size()).toBe(0);
      
      await provider.onWriteGTID('gtid-123', ['mydb.users']);
      expect(provider.size()).toBe(1);
      
      await provider.onWriteGTID('gtid-456', ['mydb.orders']);
      expect(provider.size()).toBe(2);
      
      await provider.onWriteGTID('gtid-789', ['mydb.users']); // Update existing
      expect(provider.size()).toBe(2); // Still 2, not 3
    });

    it('should clear all GTIDs', async () => {
      await provider.onWriteGTID('gtid-123', ['mydb.users']);
      await provider.onWriteGTID('gtid-456', ['mydb.orders']);
      
      expect(provider.size()).toBe(2);
      
      provider.clear();
      
      expect(provider.size()).toBe(0);
      expect(await provider.getGTID(['mydb.users'])).toBeUndefined();
      expect(await provider.getGTID(['mydb.orders'])).toBeUndefined();
    });

    it('should set default GTID for multiple tables', () => {
      provider.setDefaultGTID('default-gtid', ['mydb.users', 'mydb.orders']);
      
      expect(provider.size()).toBe(2);
      expect(provider.getAllGTIDs().get('mydb.users')).toBe('default-gtid');
      expect(provider.getAllGTIDs().get('mydb.orders')).toBe('default-gtid');
    });
  });

  describe('integration scenarios', () => {
    it('should handle complex application scenarios', async () => {
      // Simulate application startup with default GTID
      provider.setDefaultGTID('startup-gtid', ['mydb.users', 'mydb.orders']);
      
      // Simulate write operations
      await provider.onWriteGTID('write-1', ['mydb.users']);
      await provider.onWriteGTID('write-2', ['mydb.orders', 'mydb.products']);
      
      // Check GTID retrieval
      expect(await provider.getGTID(['mydb.users'])).toBe('write-1');
      expect(await provider.getGTID(['mydb.orders'])).toBe('write-2');
      expect(await provider.getGTID(['mydb.products'])).toBe('write-2');
      
      // Check size
      expect(provider.size()).toBe(3);
    });
  });
});