require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function main() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

    const supabase = createClient(supabaseUrl, supabaseServiceRole);

    const scrapeRoomEndpoint = "http://192.168.1.38:3001/scrape-room";

    // Variável para controlar o número de requisições simultâneas
    const concurrencyLimit = 1; // Defina o limite de concorrência desejado aqui

    const startTime = Date.now(); // Marca o início do processo

    try {
        const { data: rooms, error: supabaseError } = await supabase
            .from('view_rooms')
            .select('room::text');

        console.log(`Encontrado ${rooms.length} rooms para processar.`);

        if (supabaseError) {
            throw new Error(`Erro ao buscar rooms do Supabase: ${supabaseError.message}`);
        }

        if (rooms.length === 0) {
            console.log("Nenhuma room encontrada para processar.");
            return;
        }

        let processedCount = 0;
        const totalRooms = rooms.length;

        // Processa as rooms em lotes
        for (let i = 0; i < totalRooms; i += concurrencyLimit) {
            const batch = rooms.slice(i, i + concurrencyLimit);
            console.log(`\nProcessando lote ${Math.floor(i / concurrencyLimit) + 1} de ${Math.ceil(totalRooms / concurrencyLimit)} (${batch.length} rooms)...`);

            const promises = batch.map(async (entry) => {
                const currentRoomId = String(entry.room);

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
                        throw new Error(`Erro na requisição scrape-room para ${currentRoomId}: ${JSON.stringify(errorBody)}`);
                    }

                    let insertPayload = { ...await scrapeResponse.json() };
                    insertPayload.id = currentRoomId;
                    insertPayload.failed = false;

                    const { error: insertError } = await supabase
                        .from('rooms')
                        .upsert(insertPayload, { onConflict: 'id', ignoreDuplicates: false });

                    if (insertError) {
                        throw new Error(`Erro no upsert para ${currentRoomId}: ${insertError.message}`);
                    }

                    console.log(`\x1b[32mRoom ${currentRoomId} processada com sucesso.\x1b[0m`); // Cor verde para sucesso
                    return { status: 'fulfilled', roomId: currentRoomId };

                } catch (error) {
                    console.error(`\x1b[31mRoom ${currentRoomId} erro: ${error.message}\x1b[0m`); // Cor vermelha para erro
                    try {
                        // Tenta atualizar o status de falha no banco de dados
                        const { error: updateError } = await supabase
                            .from('rooms')
                            .upsert({ id: currentRoomId, failed: true }, { onConflict: 'id', ignoreDuplicates: false });
                        if (updateError) {
                            console.error(`\x1b[33mErro ao atualizar status de falha para ${currentRoomId}: ${updateError.message}\x1b[0m`); // Cor amarela para erro de atualização
                        }
                    } catch (updateDbError) {
                        console.error(`\x1b[33mErro crítico ao tentar marcar ${currentRoomId} como falha no DB: ${updateDbError.message}\x1b[0m`);
                    }
                    return { status: 'rejected', roomId: currentRoomId, reason: error.message };
                } finally {
                    // Este bloco é executado independentemente do sucesso ou falha da promessa
                    processedCount++;
                }
            });

            // Aguarda todas as promessas no lote serem resolvidas (seja sucesso ou falha)
            await Promise.allSettled(promises);
        }
        console.log(`\nProcessamento concluído. Total de rooms processadas: ${processedCount}.`);

        const endTime = Date.now(); // Marca o fim do processo
        const totalTimeInSeconds = ((endTime - startTime) / 1000).toFixed(2);
        console.log(`Tempo total gasto: ${totalTimeInSeconds} segundos.`);

    } catch (mainError) {
        console.error(`\x1b[31mErro fatal no processo principal: ${mainError.message}\x1b[0m`);
        process.exit(1);
    }
}

main();
