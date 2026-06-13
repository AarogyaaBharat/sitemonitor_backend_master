import mongoose from 'mongoose';

const DB_URL = "mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/?appName=Cluster0";
const CLIENT_DB = "tenant_sbi";

async function run() {
  try {
    const conn = await mongoose.createConnection(DB_URL, { dbName: CLIENT_DB }).asPromise();
    const User = conn.model('User', new mongoose.Schema({}, { strict: false }), 'users');

    const users = await User.find({}).lean();
    console.log("Users:", JSON.stringify(users, null, 2));

    await conn.close();
  } catch (err) {
    console.error(err);
  }
}

run();
