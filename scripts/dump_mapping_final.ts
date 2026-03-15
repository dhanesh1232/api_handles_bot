
import mongoose from 'mongoose';
import * as fs from 'fs';
import { getCrmModels } from '../src/lib/tenant/crm.models';


async function run() {
    const clientCode = 'ERIX_CLNT1';
    const uri = 'mongodb+srv://ecodservice:Reddy143@blog.bp2ex.mongodb.net/services?retryWrites=true&w=majority&appName=BLOG';
    
    try {
        await mongoose.connect(uri);
        console.log("Connected to", uri);
        
        const models = await getCrmModels(clientCode);
        const Template = models.Template;
        const tmpl = await Template.findOne({ name: 'toxin_report_gen_v1' }).lean();
        
        if (tmpl) {
            console.log("Template mapping found:", JSON.stringify(tmpl.variableMapping, null, 2));
            fs.writeFileSync('/home/dhanesh/ecodrix/ECOD/backend/template_dump.json', JSON.stringify(tmpl, null, 2));
        } else {
            console.log("Template NOT found in client db erix_clnt1");
        }
    } catch (err) {
        console.error("Error details:", err);
    } finally {
        await mongoose.disconnect();
    }
}

run();
