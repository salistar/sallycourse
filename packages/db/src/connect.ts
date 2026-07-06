import mongoose from 'mongoose';

let connecting: Promise<typeof mongoose> | null = null;

export async function connectDb(uri = process.env.MONGO_URI): Promise<typeof mongoose> {
  if (!uri) throw new Error('MONGO_URI manquant');
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!connecting) {
    connecting = mongoose.connect(uri).finally(() => {
      connecting = null;
    });
  }
  return connecting;
}
