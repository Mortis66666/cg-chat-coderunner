'use strict';

const xmpp = require('simple-xmpp'),
    config = require('./config.json'),
    Stanza = require('node-xmpp-client').Stanza,
    fs = require('fs'),
    exec = require('child_process').exec;


let queueTimer = null,
    queue = [],
    killed = false,
    readyToRespond = false;


let kill = (code) => {
    if (killed) { return; }
    killed = true;
    readyToRespond = false;
    console.log('[INFO] Closing process');
    clearInterval(queueTimer);
    setTimeout(() => process.exit(code), 3000);
};

function startQueueTimer() {
    clearInterval(queueTimer);
    queueTimer = setInterval(function() {
        if (queue.length) {
                xmpp.conn.send(queue[0]);
                queue.shift();
        } else {
            clearInterval(queueTimer)
        }
    }, 1000);
}

let sendMessage = function(conference, message) {
        try {
            let stanza = new Stanza('message', {
                to: conference,
                type: 'groupchat',
                id: config.nickname + new Date().getTime()
            });
            stanza.c('body').t(message);  

            queue.push(stanza);
            startQueueTimer();

        } catch (e) {
            console.log('[ERROR]', e);
        }
}

let lastResponseTime = Date.now();
let lastResponseCount = 0;
const MAX_BURST_RESPONSE = 10;

function canRespond() {
    if (lastResponseTime - Date.now() > 5*60*1000) {
        lastResponseCount = 0;
        lastResponseTime = Date.now();
    }
    return lastResponseCount < MAX_BURST_RESPONSE;
}

function updateResponse() {
    return (++lastResponseCount >= MAX_BURST_RESPONSE) ? " [sleeping]" : "";
}



// **************  XMPP CODE *****************

xmpp.on('online', data => {
    console.log('[INFO] Online:', data);
    config.groupchats.forEach(groupchat => {
        xmpp.join(groupchat + '@' + config.muc + '/' + config.nickname);
    });
    console.log("[Online] paused readyToRespond");
    setTimeout(()=> { 
        readyToRespond = true;
        console.log("[Online] enabled readyToRespond");
    }, 2000);

});

// xmpp.on('chat', function(from, message) {
//     console.log("[Personal Received] " + from + " : '" + message + "'");
//     for (let handler of responseHandler.handlers) {
//         const handlerName = handler.name;
//         if (handler.check(from, message)) {
//             xmpp.send(from, "[auto] " + handler.do(from, message));
//             break;
//         }
//         if (from in responseHandler.SUPER_USERS &&  handler.check(responseHandler.SUPER_USERS[from], message)) {
//             xmpp.send(from, "[auto] " + handler.do(responseHandler.SUPER_USERS[from], message));
//             break;
//         }
//     }
// });

xmpp.on('groupchat', (conference, from, message, stamp, delay) => {
    console.log( new Date().toISOString().slice(0,19) + " " + from + " " + message.replace(/\n/g,"\n    "));
    if (readyToRespond && from != config.nickname) {
        if (message.startsWith("py run")) {

            if (message.match(/import os/g) || message.match(/__import__("os")/g)) {
                return sendMessage(conference, "You are not allowed to import the os library")
            }

            const code = message.replaceAll(/^py run\s*/g, "");
            console.log("Received code:\n" + code);

            const fileName = from + ".py";

            fs.writeFile(fileName, code, (err) => {
                if (err) console.error(err);
            });

            
            exec(`python ${fileName}`, (error, stdout, stderr) => {
                if (error) {
                    sendMessage(conference, error);
                } else {
                    sendMessage(conference, `${stdout}`);
                }
                fs.unlink(fileName, (err) => {
                    if (err) console.error(err);
                });
            });
        }
    }
});

xmpp.on('error', error => {
    console.log('[ERROR] XMPP Error', error);
});

xmpp.on('close', data => {
    console.log('[ERROR] Connection closed:', data);
    kill(1);
});

xmpp.connect({
    jid: config.jid,
    password: config.password,
    host: config.host,
    port: config.port
});


process.on('exit', kill);
process.on('SIGINT', kill);
process.on('SIGUSR1', kill);
process.on('SIGUSR2', kill);
// process.on('uncaughtException', kill);
