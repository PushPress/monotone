import { Pool } from 'mysql2/promise';
import { Logger } from './logger';

interface ReplicaSelectorOptions {
  logger?: Logger;
  replicas: Pool[];
}

export class ReplicaSelector {
  private replicaIndex: number;
  private replicas: Pool[];
  private logger?: Logger;

  constructor({ replicas, logger }: ReplicaSelectorOptions) {
    this.replicaIndex = 0;
    this.replicas = replicas;
    this.logger = logger;
  }

  /**
   * Round robin replica selector
   * returns undefined if no replicas
   */
  getNextReplica() {
    this.replicaIndex = (this.replicaIndex + 1) % this.replicas.length;
    return this.replicas[this.replicaIndex];
  }
}
