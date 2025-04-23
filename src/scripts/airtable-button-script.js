// Airtable Button Script - Using Proxy for API Call

async function publishToSupabase() {
    output.markdown("# Publishing to Supabase");
    
    try {
        // Use a public CORS proxy to route the request
        const PROXY_URL = 'https://cors-anywhere.herokuapp.com/';
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
        let recordName = "Untitled";
        
        // Try to get title or name
        try {
            recordName = record.getCellValueAsString("title") || 
                         record.getCellValueAsString("Title") || 
                         record.getCellValueAsString("Name") || 
                         "Untitled";
        } catch (e) {
            // Ignore errors in getting the name
        }
        
        output.markdown(`Publishing record: **${recordName}**`);
        
        // Call the API through the proxy
        output.markdown("Calling API through proxy...");
        
        // Make the API request through the proxy
        const response = await fetch(`${PROXY_URL}${API_URL}/api/publish/${recordId}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Origin': 'https://airtable.com', // Add origin header to help with proxy
                'X-Requested-With': 'XMLHttpRequest' // Required by some CORS proxies
            },
            body: JSON.stringify({
                tableName: table.name,
                secretKey: SECRET_KEY
            })
        });
        
        // Check the response
        if (response.ok) {
            const result = await response.json();
            output.markdown("✅ Successfully published to Supabase!");
            
            if (result.data) {
                output.markdown(`**Title:** ${result.data.title || recordName}`);
                if (result.data.section_name) {
                    output.markdown(`**Section:** ${result.data.section_name}`);
                }
                output.markdown(`**Operation:** ${result.data.operation || "published"}`);
            }
        } else {
            let errorText = await response.text();
            try {
                // Try to parse the error as JSON for better formatting
                const errorJson = JSON.parse(errorText);
                errorText = errorJson.error || errorJson.message || errorText;
            } catch (e) {
                // If not JSON, use as is
            }
            
            output.markdown(`❌ Error: ${response.status} - ${errorText}`);
        }
        
    } catch (error) {
        output.markdown(`❌ Error: ${error.message}`);
        
        if (error.message.includes('Failed to fetch')) {
            output.markdown("\n### Additional Proxy Options:");
            output.markdown("1. Try using a different proxy. Some alternatives include:");
            output.markdown("   - https://api.allorigins.win/raw?url=YOUR_URL");
            output.markdown("   - https://api.codetabs.com/v1/proxy?quest=YOUR_URL");
            output.markdown("2. Note that CORS proxies may require prior access approval or have usage limits");
            output.markdown("3. Consider creating your own simple proxy if these public ones don't work");
        }
    }
}

// Comment this line out before copying to Airtable
// await publishToSupabase();