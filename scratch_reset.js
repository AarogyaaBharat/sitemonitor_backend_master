import mongoose from 'mongoose';
const run = async () => {
  try {
    const conn = await mongoose.createConnection('mongodb://localhost:27017/tenant_sbi');
    const result = await conn.db.collection('domains').updateMany(
      { dm_dark_pattern_status: 'scanning' },
      { $set: { dm_dark_pattern_status: 'pending' } }
    );
    console.log(`Reset ${result.modifiedCount} domains stuck in scanning state.`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};
run();
