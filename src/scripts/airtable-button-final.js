// Final Airtable Button Script - Using Proxy Endpoint

async function publishToSupabase() {
    output.markdown("# Publishing to Supabase");
    
    try {
        // Use our new proxy endpoint
        const API_URL = 'https://rdv-news-api.vercel.app';
        const PROXY_ENDPOINT = '/api/proxy-publish'; 
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
        output.markdown("Sending to Supabase via proxy...");
        
        // Call our proxy endpoint instead of the direct API
        const response = await fetch(`${API_URL}${PROXY_ENDPOINT}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                recordId: recordId,
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
            let errorText = "Unknown error";
            try {
                const errorData = await response.json();
                errorText = errorData.error || errorData.message || `Status: ${response.status}`;
            } catch (e) {
                errorText = await response.text() || `Status: ${response.status}`;
            }
            output.markdown(`❌ Error: ${errorText}`);
        }
    } catch (error) {
        output.markdown(`❌ Error: ${error.message}`);
        
        if (error.message.includes('Failed to fetch')) {
            output.markdown("\n### Network Error Troubleshooting");
            output.markdown("1. Verify your API is deployed at rdv-news-api.vercel.app");
            output.markdown("2. Check if your proxy endpoint is accessible");
            output.markdown("3. Your proxy endpoint should be at: /api/proxy-publish");
        }
    }
}

// Remove this line when copying to Airtable
// await publishToSupabase();