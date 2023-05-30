const axios = require('axios');
const http = require('http');

const endpointPlaceholder = 'https://api.together.xyz/api/inference';
const COOKIE = ``;
const headersPlaceholder = {
    'Content-Type': 'application/json',
    'cookie': COOKIE,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36 Edg/113.0.1774.50'
  };

  const readBody = (res, json, onData) => new Promise((resolve, reject) => {
    let buffer = '';

    res.on('data', chunk => {
        onData?.(chunk.toString());
        buffer += chunk;
    });

    res.on('end', () => {
        try {
            if (json) buffer = JSON.parse(buffer);
            resolve(buffer);
        } catch (e) {
            console.error(buffer);
            reject(e);
        }
    });
})

  async function generate({ prompt, prompt_format_string, top_p, temperature, max_tokens, frequencyPenalty, presencePenalty, onData }) {
    console.log(`Prompt length: ${(prompt+prompt_format_string).length}`);

    let currentLine = '';
    let firstBrokenChunk = '';

    let wasTimeout = false;
    let timeout;
    const timeoutPromise = new Promise(resolve => {
        timeout = setTimeout(() => {
            wasTimeout = true;
            currentLine = "";
            resolve();
        }, 15000);
    })

    const apiResponse = new Promise(async resolve => {
        const requestData = {
            max_tokens,
            stop:["<human>","</s>"],
            top_p,
            //top_k:40,
            repetition_penalty:presencePenalty,
            temperature,
            model:"sambanovasystems/BLOOMChat-176B-v1",
            prompt,
            prompt_format_string,
            stream_tokens:true,
            repetitive_penalty:frequencyPenalty
        };
        
        const responseStream = await axios.default({
            method: 'post',
            url: endpointPlaceholder,
            headers: {
              ...headersPlaceholder
            },
            data: requestData,
            responseType: 'stream',
        });
        
        responseStream.data.on('data', (chunk) => {
            chunk = chunk.toString().trim()
            try{
                if (wasTimeout) resolve();;

                if (timeout) {
                    process.stdout.write('Generating response ');
                    clearTimeout(timeout);
                    timeout = 0;
                } else {
                    process.stdout.write('.');
                }

                if(firstBrokenChunk) {
                    chunk = firstBrokenChunk + chunk
                    firstBrokenChunk = ''
                }

                if(chunk.includes("\n\n") && chunk.length>5) {
                    chunks = chunk.split("\n\n")
                    chunks.forEach(element => {
                        element=element.slice(6)
                        currentLine += JSON.parse(element).choices[0].text
                        onData(JSON.parse(element).choices[0].text)
                    });
                }
                else if(!chunk.endsWith("}")) {
                    firstBrokenChunk += chunk
                }
                else {
                    chunk=chunk.slice(6)
                    currentLine += JSON.parse(chunk).choices[0].text
                    onData(JSON.parse(chunk).choices[0].text)
                }
            } catch(e) {
                onData(chunk)
            }
        });
        
        responseStream.data.on('end', () => {
            resolve()
        });

        responseStream.data.on('error', (error) => {
            console.log("Error:",error)
            reject(error);
        });
    })

    await Promise.race([
        apiResponse,
        timeoutPromise
    ]);

    console.log(wasTimeout ? 'Timeout' : 'Done');

    return currentLine;
}

function preparePrompt(messages) {
    return messages.slice(0, -1).filter(m => m.content?.trim()).map(m => {
        let author = '';
        switch (m.role) {
            case 'user': author = '<human>'; break;
            case 'assistant': author = '<bot>'; break;
            case 'system': author = '<system>'; break;
            default: author = m.role; break;
        }

        return `${author}: ${m.content.trim()}`;
    }).join('\n') + (messages[messages.length - 1].role == 'user' ? `\n<human>: {prompt}\n<bot>:` :
        messages[messages.length - 1].role == 'assistant' ? `\n<bot>: {prompt}\n<bot>:` : `\n<${messages[messages.length - 1].role}>: {prompt}\n<bot>:`)
}

async function main() {
    const server = http.createServer(async (req, res) => {
        if (req.method.toUpperCase() === 'POST') {
            const body = await readBody(req, true);
            const {
                messages,
                temperature,
                max_tokens,
                presence_penalty,
                frequency_penalty,
                top_p,
                stream,
            } = body;

            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
            } else {
                res.setHeader('Content-Type', 'application/json');
            }

            const id = `chatcmpl-${(Math.random().toString(36).slice(2))}`;
            const created = Math.floor(Date.now() / 1000);

            if (stream) {
                const data = JSON.stringify({
                    id, created,
                    object: 'chat.completion.chunk',
                    model: 'BLOOMChat-176B-v1',
                    choices: [{
                        delta: { role: 'assistant' },
                        finish_reason: null,
                        index: 0,
                    }],
                });
                res.write(`data: ${data}\n\n`);
            }

            const prompt_format_string = preparePrompt(messages)
            const prompt = messages[messages.length-1].content

            const result = await generate(
                {
                    temperature, 
                    max_tokens, 
                    presence_penalty, 
                    frequency_penalty, 
                    top_p, 
                    prompt_format_string, 
                    prompt,
                    onData: (line) => {
                        if (stream) {
                            const data = JSON.stringify({
                                id, created,
                                object: 'chat.completion.chunk',
                                model: 'BLOOMChat-176B-v1',
                                choices: [{
                                    delta: { content: line },
                                    finish_reason: null,
                                    index: 0,
                                }]
                            });
                            res.write(`data: ${data}\n\n`);
                        }
                    },
                }
                )
            
            if (stream) {
                const data = JSON.stringify({
                    id, created,
                    object: 'chat.completion.chunk',
                    model: 'BLOOMChat-176B-v1',
                    choices: [{
                        delta: {},
                        finish_reason: 'stop',
                        index: 0,
                    }],
                });
                res.write(`data: ${data}\n\ndata: [DONE]\n\n`);
            } else {
                res.write(JSON.stringify({
                    id, created,
                    object: 'chat.completion',
                    model: 'BLOOMChat-176B-v1',
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: result,
                        },
                        finish_reason: 'stop',
                        index: 0,
                    }]
                }));
            }

            res.end();
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.write(JSON.stringify({
                object: 'list',
                data: [
                    { id: 'BLOOMChat-176B-v1', object: 'model', created: Date.now(), owned_by: 'SambaNova', permission: [], root: 'BLOOMChat-176B-v1', parent: null },
                ]
            }));
        }
        res.end();
    });

    server.listen(5011, '0.0.0.0', () => {
        console.log(`proxy for BLOOMChat-176B-v1: 'http://127.0.0.1:5011/'`);
    });
}

main().catch(console.error);