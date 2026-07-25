import mongoose from 'mongoose';

const run = async () => {
  const tenants = ['tenant_sbi', 'tenant_rbi'];

  for (const tenant of tenants) {
    try {
      const conn = await mongoose
        .createConnection(
          `mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/${tenant}?retryWrites=true&w=majority&appName=Cluster0`
        )
        .asPromise();

      const domainCollection = conn.collection('domains');

      // Get all domains
      const domains = await domainCollection.find({}).toArray();

      console.log(`\n========== ${tenant} ==========`);
      console.log(`Total Domains: ${domains.length}\n`);

      for (const domain of domains) {
        console.log(
          `Updating Domain -> ID: ${domain._id}, Name: ${domain.domain_name || domain.domain}`
        );

        const result = await domainCollection.updateOne(
          { _id: domain._id },
          {
            $set: {
              dm_dark_pattern_status: 'pending',
            },
          }
        );

        console.log(
          `✔ Updated: ${result.modifiedCount === 1 ? 'Success' : 'Skipped'}`
        );
      }

      await conn.close();
      console.log(`Connection closed for ${tenant}\n`);
    } catch (error) {
      console.error(`Error in ${tenant}:`, error);
    }
  }

  process.exit(0);
};

run();