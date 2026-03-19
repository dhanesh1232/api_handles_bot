import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { join } from 'path';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_URI_END = process.env.MONGODB_URI_END;

async function checkDB() {
  const fullUri = `${MONGODB_URI}saas${MONGODB_URI_END}`;
  console.log("Connecting to:", fullUri);
  await mongoose.connect(fullUri);
  
  const CorsOrigin = mongoose.model('CorsOrigin', new mongoose.Schema({}, { strict: false }), 'corsorigins');
  
  const all = await CorsOrigin.find({});
  console.log("All Origins in DB:", all.map(o => ({ url: o.url, isActive: o.isActive })));
  
  const target = await CorsOrigin.findOne({ url: /thepathfinderr.com/i });
  console.log("Target in DB:", target);
  
  await mongoose.connection.close();
}

checkDB().catch(console.error);
