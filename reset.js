import mongoose from 'mongoose';
const run = async () => {
  const conn = await mongoose.createConnection('mongodb://localhost:27017/tenant_sbi').asPromise();
  const res = await conn.collection('domains').updateMany(
    { dm_dark_pattern_status: 'scanning' },
    { $set: { dm_dark_pattern_status: 'pending' } }
  );
  console.log('Reset:', res.modifiedCount);
  process.exit(0);
};
run();
