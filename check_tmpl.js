import mongoose from "mongoose";

const uri =
  "mongodb+srv://dhaneshreddy980_db_user:Reddy1430@client.auty24k.mongodb.net/nirvisham-clinic?appName=Client";

async function checkTemplate() {
  await mongoose.connect(uri);

  const Template = mongoose.model(
    "Template",
    new mongoose.Schema({}, { strict: false, collection: "templates" }),
  );
  const nv = await Template.findOne({ name: "nv_doctor_book" });
  if (nv) {
    console.log("--- nv_doctor_book Detail ---");
    console.log(JSON.stringify(nv, null, 2));
  } else {
    console.log("nv_doctor_book NOT found");
  }

  await mongoose.disconnect();
}

checkTemplate().catch(console.error);
