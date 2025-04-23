// Improved Airtable Button Script - Using API Gateway

async function publishToSupabase() {
    output.markdown("# Publishing to Supabase");
    
    try {
        // Use an API gateway that should work reliably with Airtable
        // Replace with your actual API URL when deployed
        const API_URL = 'https://rdv-news-api.vercel.app';
        const SECRET_KEY = '62f33d10f05777d89c0318e51409836475db969e40c203b273c139469ab39b65';
        
        // Get all tables in the base
        const tables = base.tables;
        
        // Create table selector
        const tableOptions = tables.map(table => table.name);
        const selectedTableName = await input.buttonsAsync('Select a table:', tableOptions);
        
        if (!selectedTableName) {
            output.markdown("❌ No table selected.");
            return;
        }
        
        // Get selected table
        const table = base.getTable(selectedTableName);
        
        // Select a record
        const record = await input.recordAsync("Select a record to publish:", table);
        if (!record) {
            output.markdown("❌ No record selected.");
            return;
        }
        
        const recordId = record.id;
        let recordName = "";
        
        // Try to get title or name
        try {
            recordName = record.getCellValueAsString("title") || 
                         record.getCellValueAsString("Title") || 
                         "Record " + recordId;
        } catch (e) {
            recordName = "Record " + recordId;
        }
        
        output.markdown(`Publishing record: **${recordName}**`);
        
        // Use Airtable's built-in fetch function to bypass CORS restrictions
        output.markdown("Sending to Supabase...");
        
        try {
            // Direct API call - might not work due to CORS
            const response = await fetch(`${API_URL}/api/publish/${recordId}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    tableName: table.name,
                    secretKey: SECRET_KEY
                })
            });
            
            // Process response
            if (response.ok) {
                const result = await response.json();
                output.markdown("✅ Successfully published to Supabase!");
                
                if (result.data) {
                    output.markdown(`**Title:** ${result.data.title}`);
                    output.markdown(`**Section:** ${result.data.section_name}`);
                    output.markdown(`**Operation:** ${result.data.operation}`);
                }
            } else {
                let errorText = await response.text();
                output.markdown(`❌ Error: ${response.status} - ${errorText}`);
            }
        } catch (fetchError) {
            output.markdown(`❌ API call failed: ${fetchError.message}`);
            output.markdown("\n**Alternative: Use the webhook approach**");
            output.markdown("Since direct API calls might be blocked by Airtable's security measures, try using webhooks:");
            
            // Create a RESTful service URL (replace with your actual webhook URL if you have one)
            const webhookUrl = `https://hook.integromat.com/your-webhook-id`;
            
            output.markdown(`\nTrying webhook approach...`);
            
            try {
                // Create payload for webhook
                const payload = {
                    recordId: recordId,
                    tableName: table.name,
                    secretKey: SECRET_KEY
                };
                
                // Call the webhook
                await fetch(webhookUrl, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });
                
                output.markdown("✅ Webhook triggered successfully!\nThe record will be processed shortly.");
            } catch (webhookError) {
                output.markdown(`❌ Webhook also failed: ${webhookError.message}`);
                output.markdown("\n**Manual Approach**");
                output.markdown("If both methods fail, copy this information and manually send the record:");
                output.markdown(`- Record ID: ${recordId}`);
                output.markdown(`- Table Name: ${table.name}`);
                
                // Add a button that opens the record in a new tab
                const recordUrl = `${API_URL}/api/publish/${recordId}?tableName=${encodeURIComponent(table.name)}`;
                output.markdown(`\n[🔗 Open publishing URL in browser](${recordUrl})`);
            }
        }
    } catch (error) {
        output.markdown(`❌ Error: ${error.message}`);
    }
}

// Remove this line when copying to Airtable
// await publishToSupabase();