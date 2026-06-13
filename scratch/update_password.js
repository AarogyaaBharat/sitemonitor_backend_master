import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const DB_URL = "mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/?appName=Cluster0";
const CLIENT_DB = "tenant_sbi";
const EMAIL = "vinod@yopmail.com";
const NEW_PASSWORD = "password123";

async function run() {
  try {
    const conn = await mongoose.createConnection(DB_URL, { dbName: CLIENT_DB }).asPromise();
    const User = conn.model('User', new mongoose.Schema({}, { strict: false }), 'users');

    const hashedPassword = await bcrypt.hash(NEW_PASSWORD, 10);
    const result = await User.updateOne({ user_email: EMAIL }, { $set: { user_password: hashedPassword } });
    console.log("Update result:", result);

    await conn.close();
  } catch (err) {
    console.error(err);
  }
}

run();
