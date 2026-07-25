import mongoose from 'mongoose';
const run = async () => {
  const tenants = ['tenant_sbi', 'tenant_rbi'];
  for (const t of tenants) {
    const conn = await mongoose.createConnection('mongodb://localhost:27017/' + t).asPromise();
    const res = await conn.collection('domains').updateMany(
      { dm_dark_pattern_status: 'scanning' },
      { $set: { dm_dark_pattern_status: 'pending' } }
    );
    console.log(t, 'Reset:', res.modifiedCount);
    await conn.close();
  }
  process.exit(0);
};
run();
