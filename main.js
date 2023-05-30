const https = require('https');
const http = require('http');
const puppeteer = require('puppeteer');

const COOKIE = ``;

const options = {
    hostname: 'play.vercel.ai',
    port: 443,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
};

function insertRandomCharacter(str) {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-=_+[]{}|;':\",./<>?";
    const randomIndex = Math.floor(Math.random()* characters.length);
    const randomCharacter = characters.charAt(randomIndex);
  
    const insertionIndex = Math.floor(Math.random() * (str.length + 1));
    return str.slice(0, insertionIndex) + randomCharacter + str.slice(insertionIndex);
}

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

const request = (path, data, encoding, onData) =>
    new Promise((resolve, reject) => {
        options.headers['User-Agent'] = `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/${Math.floor(Math.random() * 10000000)} Firefox/${(Math.random() * 200).toFixed(2)}`;
        options.headers['Cookie'] = `user_session=${COOKIE.trim()}`;
        options.headers['Custom-Encoding'] = encoding;
        const req = https.request({ ...options, path }, async (res) => {
            try {
                const body = await readBody(res, false, onData);
                resolve(body);
            } catch (e) {
                reject(e);
            }
        });

        req.write(JSON.stringify(data));
        req.end();
    });

async function generate(text, { model, temperature, topP, maxTokens, frequencyPenalty, presencePenalty, onData }, encoding) {
    console.log(`Model: ${model}\nPrompt length: ${text.length}`);

    let currentLine = '';

    let wasTimeout = false;
    let timeout;
    const timeoutPromise = new Promise(resolve => {
        timeout = setTimeout(() => {
            wasTimeout = true;
            currentLine = "";
            resolve();
        }, 15000);
    })

    await Promise.race([
        request('/api/generate', {
            prompt: text,
            model,
            temperature,
            maxTokens: Math.min(maxTokens, 511),
            topP,
            frequencyPenalty,
            presencePenalty,
            stopSequences: model.startsWith('anthropic:claude') ? ['\nHuman:'] : [],
        }, encoding, 
        (line) => {
            if (wasTimeout) return;

            if (timeout) {
                process.stdout.write('Generating response ');
                clearTimeout(timeout);
                timeout = 0;
            } else {
                process.stdout.write('.');
            }
            line = ((l) => {
                try {
                    return JSON.parse(l);
                } catch (e) {
                    return l;
                }
            })(line);

            if (model.startsWith('anthropic:claude') && line.trim()) {
                onData?.(line.slice(currentLine.length));
                currentLine = line;
            } else {
                onData?.(line);
                currentLine += line;
            }
        }),
        timeoutPromise,
    ]);

    console.log(wasTimeout ? 'Timeout' : ' Done');

    return currentLine;
}

function preparePrompt(messages) {
    return messages.filter(m => m.content?.trim()).map(m => {
        let author = '';
        switch (m.role) {
            case 'user': author = 'Human'; break;
            case 'assistant': author = 'Assistant'; break;
            case 'system': author = 'System Note'; break;
            default: author = m.role; break;
        }

        return `${author}: ${m.content.trim()}`;
    }).join('\n') + `\nAssistant: `;
}

async function getEncoding(updateEncodingJsonCallback) {
    try {
        const options = {
            hostname: 'play.vercel.ai',
            path: '/openai.jpeg',
            method: 'GET',
            headers: {
                'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/${Math.floor(Math.random() *10000000)} Firefox/${(Math.random()* 200).toFixed(2)}`,
                'Cookie': `user_session=${COOKIE.trim()}`
            }
        };

        const request = https.request(options, (response) => {
            let data = "";

            response.on('data', (chunk) => {
                data += chunk.toString()
            });

            response.on('end', () => {
                const body = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
                const codeFunction = eval(`(${body.c})`);
                const result = codeFunction(body.a);
                r_key = result[0];
                if (isNaN(result[0])) r_key = null;

                const encodingJson = {
                    "r": [r_key, [], "sentinel"],
                    "t": body.t
                };

                updateEncodingJsonCallback(encodingJson);
            });
        });

        request.on('error', (error) => {
            console.error(error);
        });

        request.end();
    } catch (error) {
        console.error(error);
    }
}

async function connectToVercel(updateEncodingJsonCallback) {
    const browser = await puppeteer.launch({
        headless: 'new'
    })
    const page = await browser.newPage();

    page.on('response', async response => {
        if (response.url() == "https://play.vercel.ai/openai.jpeg") {
            const base64String = await response.text()
            const body = JSON.parse(Buffer.from(base64String, 'base64').toString('utf8'))
            const codeFunction = eval(`(${body.c})`);
            const result = codeFunction(body.a);
            r_key = result[0]
            if(isNaN(result[0])) r_key = null
            const encodingJson = {
                "r":[r_key,[],"sentinel"],
                "t":body.t
            }
            updateEncodingJsonCallback(encodingJson)
        }
    });

    // Define the cookie you want to inject
    const cookie = {
        "domain": "play.vercel.ai",
        "expirationDate": 2000000000,
        "hostOnly": true,
        "httpOnly": true,
        "name": "user_session",
        "path": "/",
        "sameSite": "None",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": COOKIE.trim()
    };

    // Inject the cookie into the page
    await page.setCookie(cookie);

    await page.goto('https://play.vercel.ai/');

    //await browser.close();
}

async function main() {
    let encodingJson = {}

    const waitForEncodingJson = () => new Promise(resolve => {
        const checkEncodingJson = () => {
            if (Object.keys(encodingJson).length === 0) {
                setTimeout(checkEncodingJson, 100);
            } else {
                setTimeout(resolve, 2000);
            }
        }
        checkEncodingJson();
    });

    function updateJson(newEncodingJson) {
        encodingJson = newEncodingJson
    }

    const server = http.createServer(async (req, res) => {
        if (req.method.toUpperCase() === 'POST') {
            try {
                if (Object.keys(encodingJson).length === 0) {
                    console.log("Ждем прогрузки vercel.ai")
                    await waitForEncodingJson();
                }

                const body = await readBody(req, true);
                const [, owner, modelName] = req.url.split('/');
                const model = `${owner}:${modelName}`;

                const jsonString = JSON.stringify(encodingJson);
                const encoding = Buffer.from(jsonString, 'utf8').toString('base64');

                const {
                    messages,
                    temperature,
                    top_p,
                    max_tokens,
                    presence_penalty,
                    frequency_penalty,
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
                        model: modelName,
                        choices: [{
                            delta: { role: 'assistant' },
                            finish_reason: null,
                            index: 0,
                        }],
                    });
                    res.write(`data: ${data}\n\n`);
                }

                let prompt = preparePrompt(messages);
                prompt = insertRandomCharacter(prompt)
                const result = await generate(prompt, {
                    model,
                    temperature,
                    topP: top_p,
                    maxTokens: max_tokens,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                    onData: (line) => {
                        if (stream) {
                            const data = JSON.stringify({
                                id, created,
                                object: 'chat.completion.chunk',
                                model: modelName,
                                choices: [{
                                    delta: { content: line },
                                    finish_reason: null,
                                    index: 0,
                                }]
                            });
                            res.write(`data: ${data}\n\n`);
                        }
                    }
                },
                encoding);

                if (stream) {
                    const data = JSON.stringify({
                        id, created,
                        object: 'chat.completion.chunk',
                        model: modelName,
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
                        model: modelName,
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
            } catch (err) {
                console.error(err);
                res.statusCode = 500;
                res.write('Error: ' + err.message);
                res.end();
            }
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.write(JSON.stringify({
                object: 'list',
                data: [
                    { id: 'claude-v1', object: 'model', created: Date.now(), owned_by: 'anthropic', permission: [], root: 'claude-v1', parent: null },
                    { id: 'gpt-3.5-turbo', object: 'model', created: Date.now(), owned_by: 'openai', permission: [], root: 'gpt-3.5-turbo', parent: null },
                ]
            }));
        }
        res.end();
    });

    server.listen(5004, '0.0.0.0', async () => {
        connectToVercel(updateJson)
        console.log(`proxy for claude-v1: 'http://127.0.0.1:5004/anthropic/claude-v1'`);
    });
}

main().catch(console.error);
