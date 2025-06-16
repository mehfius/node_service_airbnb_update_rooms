require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function main() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

    const supabase = createClient(supabaseUrl, supabaseServiceRole);

    const scrapeRoomEndpoint = "http://192.168.1.38:3001/scrape-room";

    try {
        const { data: rooms, error: supabaseError } = await supabase
            .from('view_rooms')
            .select('room::text');

        console.log(`Encontrado ${rooms.length} room para processar.`);

        if (supabaseError) {
            throw new Error();
        }

        if (rooms.length === 0) {
            return;
        }

        let processedCount = 0;
        for (const entry of rooms) {
            const currentRoomId = String(entry.room);

            processedCount++;

            try {
                const scrapePayload = {
                    room_id: currentRoomId
                };

                const scrapeResponse = await fetch(scrapeRoomEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(scrapePayload)
                });

                if (!scrapeResponse.ok) {
                    const errorBody = await scrapeResponse.json();
                    throw new Error(`Fetch error: ${JSON.stringify(errorBody)}`);
                }

                let insertPayload = { ...await scrapeResponse.json() };

                insertPayload.id = currentRoomId; 
                insertPayload.failed = false;

                const { error: insertError } = await supabase
                    .from('rooms')
                    .upsert(insertPayload, { onConflict: 'id', ignoreDuplicates: false });

                if (insertError) {
                    throw new Error(`Upsert error: ${insertError.message}`);
                }

                console.log(`Room ${currentRoomId} sucesso.`);

            } catch (error) {
                console.log(`\x1b[31mRoom ${currentRoomId} erro: ${error.message}\x1b[0m`);
                try {
                    const { error: updateError } = await supabase
                        .from('rooms')
                        .upsert({ id: currentRoomId, failed: true }, { onConflict: 'id', ignoreDuplicates: false });
                } catch {}
            }
        }
    } catch {
        process.exit(1);
    }
}

main();