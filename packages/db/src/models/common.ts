import { Schema } from 'mongoose';

// Sous-schéma de log partagé (generation-job, deployment).
export interface LogEntry {
  ts: Date;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export const logEntrySchema = new Schema<LogEntry>(
  {
    ts: { type: Date, default: Date.now },
    level: { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
    msg: { type: String, required: true },
  },
  { _id: false },
);
