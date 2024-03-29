/*** GLOBAL VARIABLES */

/**
 * Current information about user and peer
 */
const currData = {
    joining: false,
    room: '',
    pathServer: '',
    nickname: 'luc',
    /* peer id generated on page refresh */
    peerId: window.crypto.randomUUID(),
    onMessage(messages) {
        console.log(messages.pop());
    },
    crypto: false,
    signKeyPair: {
        /** @type {string} */
        publicKey: undefined,
        /** @type {CryptoKey} */
        privateKey: undefined
    },
    cryptoKeyPair: {
        /** @type {string} */
        publicKey: undefined,
        /** @type {CryptoKey} */
        privateKey: undefined
    },
    connectedPeerIds: new Set()
};

const idealPeerConnectionNumber = 20;
const idealMinimalNumberOfPeers = 5;

const proposalLifeTimeMillis = 10000;

const ceilLimitProposalCreation = 5;
const idealTTL = 32;

/**
 * Temporary container of webRTC peer connection offers and answers.
 * Once the connection is established the connections are moved into
 * `peerConnections`.
 * 
 * 
 * @see {peerConnections}
 * */
const proposalsPeerConnections = [];

/**
 * Retire la proposition de la liste et renvoie cette proposition.
 * @param {number} id peer connection id
 * @returns {import('./peers').PeerConnection | null}
 */
proposalsPeerConnections.remove = (id) => {
    let i = proposalsPeerConnections.findIndex(pc => pc.id == id);
    if (i == -1) return null;
    let ret = proposalsPeerConnections[i];
    for (; i < proposalsPeerConnections.length;) {
        proposalsPeerConnections[i] = proposalsPeerConnections[++i];
    }
    proposalsPeerConnections.pop();
    return ret;
};

/**
 * @typedef {RTCPeerConnection & {channel: RTCDataChannel, id: number}} PeerConnection
 */

/**
 * Established and active connections.
 * @type {Array<PeerConnection>}
 * */
const peerConnections = [];

/**
 * Retire la proposition de la liste et renvoie cette proposition.
 * @param {number} id peer connection id
 * @returns {import('./peers').PeerConnection | null}
 */
peerConnections.close = (id) => {
    let i = peerConnections.findIndex(pc => pc.id == id);
    if (i == -1) return null;
    peerConnections[i].close();
    for (; i < peerConnections.length;)
        peerConnections[i] = peerConnections[++i];
    peerConnections.pop();
};

/*** CRYPTO IMPLEMENTATION */

function randomInt(max) {
    return Math.floor(Math.random() * max);
}

const signAlgo = {
    name: "ECDSA",
    namedCurve: "P-384"
};

const cryptoAlgo = {
    name: "RSA-OAEP",
    modulusLength: 4096,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
};

/**
 * @return {Promise<CryptoKeyPair>}
 */
const genSignKeyPair = async () => {
    /** @type {CryptoKeyPair} */
    let { privateKey, publicKey } = await window.crypto.subtle.generateKey(
        {
            name: "ECDSA",
            namedCurve: "P-384"
        },
        true,
        ["sign", "verify"]
    );
    let buf = await window.crypto.subtle.exportKey("spki", publicKey);
    let pubkey = String.fromCharCode.apply(null, new Uint8Array(buf));
    currData.signKeyPair.publicKey = btoa(pubkey);
    currData.signKeyPair.privateKey = privateKey;
};


/**
 * @return {Promise<CryptoKeyPair>}
 */
const genCryptoKeyPair = async () => {
    /** @type {CryptoKeyPair} */
    let { privateKey, publicKey } = await window.crypto.subtle.generateKey(
        cryptoAlgo,
        true,
        ["encrypt", "decrypt"]
    );
    let buf = await window.crypto.subtle.exportKey("spki", publicKey);
    let pubkey = String.fromCharCode.apply(null, new Uint8Array(buf));
    currData.cryptoKeyPair.publicKey = btoa(pubkey);
    currData.cryptoKeyPair.privateKey = privateKey;
};

/** Get from front end storage the keys given an id.
 * The ID could be a name like `Ted`. The keys stored for Ted will be used
 * and will still be the same in the next session.
 */
let getKeysFromStorage = (_id) => { /* to be defined by front end */ };
let setKeysToStorage = (_id, _keys) => { /* to be defined by front end */ };

/**
 * Is called when no more connexions are registred.
 */
let onPeerConnectionsLost = () => { /* to be defined by front end */ };

function importFromString(key, algo, usage) {
    return window.crypto.subtle.importKey(
        "pkcs8",
        str2ab(atob(key)),
        algo,
        true,
        [ usage ]
    );
}

function importPeerCryptoKey(key) {
    return window.crypto.subtle.importKey(
        "spki",
        str2ab(atob(key)),
        cryptoAlgo,
        true,
        [ "encrypt" ]
    );
}

async function exportAsString(key) {
    let buf = await window.crypto.subtle.exportKey("pkcs8", key);
    let pubkey = String.fromCharCode.apply(null, new Uint8Array(buf));
    return btoa(pubkey);
}

// derive string key
async function deriveKey(password) {
    const algo = {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('a-unique-salt'),
      iterations: 1000
    };

    console.log("gen priv key");

    let privkey = await window.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        { name: algo.name },
        false,
        [ 'deriveKey' ]
    );

    console.log("symetric priv key generated from password");

    return window.crypto.subtle.deriveKey(
        algo,
        privkey,
        {
            name: 'AES-GCM',
            length: 256
        },
        false,
        [ 'encrypt', 'decrypt' ]
    );
}

/**
 * Encrypt function
 * @param {string} str 
 * @param {string} password
 * @returns {Promise<string>}
 */
async function encrypt(str, password) {
    const algo = {
        name: 'AES-GCM',
        length: 256,
        iv: window.crypto.getRandomValues(new Uint8Array(12))
    };

    console.log("encrypt");
    let key = await deriveKey(password);

    // get encrypted buffer
    let buf = await window.crypto.subtle.encrypt(
        algo,
        key,
        new TextEncoder().encode(str)
    );

    let cipherText = btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));

    return JSON.stringify({
        cipherText,
        iv: btoa(String.fromCharCode.apply(null, algo.iv))
    });
}
  
/**
 * Decrypt function
 * @param {string} str 
 * @param {string} password
 * @returns {Promise<string>}
 */
async function decrypt(str, password) {
    let encrypted = JSON.parse(str);
    const algo = {
        name: 'AES-GCM',
        length: 256,
        iv: str2ab(atob(encrypted.iv))
    }

    let key = await deriveKey(password);
    let cipherText = str2ab(atob(encrypted.cipherText));
    let dec = await window.crypto.subtle.decrypt(
        algo,
        key,
        cipherText
    );
    return new TextDecoder().decode(dec);
}

/**
 * Encrypt function
 * @param {string} str 
 * @param {string} password
 * @returns {Promise<string>}
 */
async function encryptWithKey(str, key) {
    // get encrypted buffer
    let buf = await window.crypto.subtle.encrypt(
        cryptoAlgo,
        key,
        new TextEncoder().encode(str)
    );

    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
}

/**
 * Decrypts message from mesh.
 * 
 * When we receive an encrypted message from the mesh. We check if the message is destinated
 * to the local peer by checking the nickname. If any, the content is decrypted here using the
 * current private crypto key.
 * 
 * TODO: next feature, it would be great to load multiple private keys at once. So we'll not
 * check the current nickname, but the names we associate to them.
 * @param {string} cipherText
 * @returns {Promise<string>}
 */
async function decryptWithLocalKey(cipherText) {
    if (currData.cryptoKeyPair.privateKey === undefined) {
        console.warning("no keys to decrypt the content")
        throw "decrypt keys are required";
    }

    let dec = await window.crypto.subtle.decrypt(
        cryptoAlgo,
        currData.cryptoKeyPair.privateKey,
        str2ab(atob(cipherText))
    );
    return new TextDecoder().decode(dec);
}

async function loadKeys(id, password) {
    let keys = getKeysFromStorage(id);
    if (keys !== undefined) {
        keys = JSON.parse(await decrypt(keys, password));
        currData.signKeyPair.privateKey = await importFromString(keys.signKeyPair.privateKey, signAlgo, "sign");
        currData.signKeyPair.publicKey = keys.signKeyPair.publicKey;
        console.log("sign key imported")
        currData.cryptoKeyPair.privateKey = await importFromString(keys.cryptoKeyPair.privateKey, cryptoAlgo, "decrypt");
        currData.cryptoKeyPair.publicKey = keys.cryptoKeyPair.publicKey;
        console.log("crypto key imported");
    } else {
        await genSignKeyPair();
        await genCryptoKeyPair();
        console.log("keys generated");
    
        keys = {
            signKeyPair: {
                publicKey: currData.signKeyPair.publicKey,
                privateKey: await exportAsString(currData.signKeyPair.privateKey),
            },
            cryptoKeyPair: {
                publicKey: currData.cryptoKeyPair.publicKey,
                privateKey: await exportAsString(currData.cryptoKeyPair.privateKey),
            }
        };
    
        setKeysToStorage(id, await encrypt(JSON.stringify(keys), password));
    }
    currData.crypto = true;
}


/****** MESSAGES IMPLEMENTATION */

/**
 * @typedef {Object} ChatMessage
 * @property {string} id
 * @property {number} timestamp
 * @property {boolean | undefined} encrypted
 * @property {string | { to: string, data: string }} content
 * @property {string} nickname
 * @property {string | undefined} signature
 * @property {string | undefined} pubkey
 * @property {string | undefined} cryptoKey
 */

const messagesReceived = {};

/** function called when a message is received from the mesh */
let onMessageIncoming = () => { };
let onPrepareWsProposal = () => { };
let onSendWsProposal = () => { };
let onWsProposalAnswerOpened = () => { };
let onConnectionToRoomDone = () => { };
let getAudioElt = () => { };
let userAcceptCall = (_callback) => { };

// Les ids sont ordonné par le nombre de fois qu'on les a reçus.
const messagesInfo = {
    // constante arbitraire pour donner
    // un maximum. Si on le depasse, on flambe.
    maxSize: 6000,
    length: 0,
    histogram: {},
    /** liste ordonée des identifiants @type {string[]} */
    order: [],

    channelsIdsMap: {},

    push(id, channel) {
        if (this.channelsIdsMap[id] === undefined) {
            this.channelsIdsMap[id] = [];
        }
        if (!this.channelsIdsMap[id].includes(channel)) {
            this.channelsIdsMap[id].push(channel);
        }
        if (this.histogram[id] === undefined) {
            this.histogram[id] = 1;
            this.order.push(id);
            this.order.sort((idA, idB) =>
                this.histogram[idA] > this.histogram[idB]);
            this.length++;
        } else {
            this.histogram[id]++;
        }
    },

    channelsKnowId(id) {
        let channels = this.channelsIdsMap[id];
        if (channels === undefined) {
            channels = [];
        }
        return channels;
    },

    /**
     * @returns {{channels: RTCDataChannels[], id: String | undefined}}
     */
    get() {
        let id = this.order.shift();
        let channels = this.channelsKnowId(id);
        return {
            channels,
            id
        };
    },

    delete(id) {
        delete this.channelsIdsMap[id];
        delete this.histogram[id];
        for (let i = this.order.indexOf(id); i < this.order.length - 1;) {
            this.order[i] = this.order[++i];
        }
        this.order.pop();
        this.length--;
    },
};

let pullMessageTimeout = 0;

/**
* @param {RTCDataChannel} currChannel
* @param {String} id
*/
function onMsgIdentifierReceived(id, currChannel) {
    console.log("message identifier received");
    if (messagesInfo.length > messagesInfo.maxSize) {
        return console.warn("too much messages in the raw, fly!");
    }
    if (messagesReceived[id] !== undefined) {
        return;
    }
    messagesInfo.push(id, currChannel);

    if (pullMessageTimeout == 0) {
        function onPullMessageTimeout() {
            pullMessage();
            if (messagesInfo.length > 0) {
                pullMessageTimeout = setTimeout(onPullMessageTimeout, 100);
            } else {
                pullMessageTimeout = 0;
            }
        }
        pullMessageTimeout = setTimeout(onPullMessageTimeout, 100);
    }
}

/**
* @param {RTCDataChannel} currChannel
* @param {String} id
*/
function onMsgRequestReceived(id, currChannel) {
    console.log("message request received");
    const message = messagesReceived[id];
    if (message === undefined) {
        /* Je ferme la connexion si on me demande quelque
         chose que je ne connais pas car ça ne devrait pas
         arriver. banPeerByChannelId(currChannel.id) TODO: a faire
         après stabilisation */
        return;
    }
    const msg = {
        path: rootMessageResponse,
        args: message,
    }
    currChannel.send(JSON.stringify(msg));
}

/*
Convert a string into an ArrayBuffer
from https://developers.google.com/web/updates/2012/06/How-to-convert-ArrayBuffer-to-and-from-String
*/
function str2ab(str) {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
}

/**
 * Check if a signed message has a valid signature and content. The
 * message input require to have a `pubkey` and a `signature`.
 * 
 * @param {ChatMessage} message
 * @returns {Promise<boolean>}
 */
async function verifyMessage(message) {
    let pubkeyStr = atob(message.pubkey);
    let pubkeyBuffer = str2ab(pubkeyStr);
    let data = new TextEncoder().encode(`${message.id}${message.encrypted ? message.content.data : message.content}${message.timestamp}${message.nickname}`);

    let pubkey = await window.crypto.subtle.importKey(    
        "spki",
        pubkeyBuffer,
        {
            name: "ECDSA",
            hash: { name: "SHA-384" },
        },
        true,
        ["verify"]
    );

    return window.crypto.subtle.verify(
        {
            name: "ECDSA",
            hash: { name: "SHA-384" },
        },
        pubkey,
        str2ab(atob(message.signature)),
        data
    );
}

/**
 * On a complete message containing text is received from the RTC mesh.
 * @param {ChatMessage} message
 * @param {RTCDataChannel} _currChannel
 */
function onMessageReceived(message, _currChannel) {
    if (messagesReceived[message.id] !== undefined) {
        /* skip if message has already been received */
        return;
    }

    async function _receive() {
        /**
         * Local representation of the message. We don't modify the original. 
         * @type {ChatMessage & { verified: boolean | undefined }} */
        let local = Object.create(message)
        if (message.pubkey !== undefined && message.signature !== undefined) {
            let res = await verifyMessage(message);
            /* TODO: after stabilization of the feature we should ban any channel
                that send us an invalid message.
                if (!res) banPeerByChannelId(currChannel.id); */
            local.verified = res;
        } else if (message.pubkey === undefined && message.signature === undefined) {
            /* correct behavior, nothing to do <=> local.verified = undefined; */
        } else {
            console.warn("strange behaviour behind the message " + message.id);
            /* TODO: after stabilization of the feature we should ban any channel
                that send us an invalid message.
                banPeerByChannelId(currChannel.id); */
            local.verified = false;
        }

        console.log(message);

        /* If message content is an object, if he contains a `to` property
           and if the message is encrypted => decrypt the message. There is no reason
           to have an encrypted message without an object as content. */
        if (message.encrypted) {
            /** @see decryptWithLocalKey for a TODO comment */
            if (message.content.to == currData.nickname) {
                try {
                    local.content = await decryptWithLocalKey(message.content.data);
                    onMessageIncoming(local);
                } catch (err) {
                    /* don't dismiss the message, it can be destinated to someone else */
                    console.warn(`unable to decrypt a message that is destinated to user ${currData.nickname}`);
                    console.warn(err);
                }
            } else {
                console.warn("dismiss message: encrypted message should have an Object as content");
                throw "message dissmissed";
            }
        } else if (typeof message.content === "string") {
            onMessageIncoming(local);
        } else {
            console.warn("dismiss message: normal message text content should be a string");
            throw "message dissmissed";
        }

        messagesReceived[message.id] = message;
        /** @type {[]} */
        let channelsIdsThatKnow = messagesInfo.channelsKnowId(message.id);
        messagesInfo.delete(message.id);

        /* Forward the message to the other peers.
            ----
            Une fois reçu, je peux forward à tout mon entourage
            l'id du message. */
        peerConnections.forEach(pc => {
            if (channelsIdsThatKnow.includes(pc.channel.id)) {
                /* Skip the peers that has sent me the id
                    (it means they already have the full message) */
                return;
            }
            const msg = {
                path: rootMessageIdentifier,
                args: message.id,
            };
            pc.channel.send(JSON.stringify(msg));
        });
    }

    _receive().then(() => {
        console.log("message received: success");
    }).catch(err => {
        console.warn(`message received: ${err}`);
    });
}

/**
 * Fonction appelé régulièrement pour aller chercher le message
 * le plus répendu. 
 */
function pullMessage() {
    const info = messagesInfo.get();
    const msg = { path: rootMessageRequest, args: info.id };
    const tryPull = () => {
        /** @type {RTCDataChannel} */
        if (info.channels.length == 0) {
            return;
        }
        const channel = info.channels.pop()
        channel.send(JSON.stringify(msg));
        setTimeout(() => {
            if (messagesReceived[info.id] !== undefined) {
                return;
            }
            setTimeout(() => {
                console.log("peer failes to return message");
                /* TODO: when feature stable banPeerByChannelId(channel.id); */
            }, 10000);
            
            tryPull();
        }, 200);
    };

    tryPull();
}

/**
 * Sign a given message concatenated a date and the current nickname
 * @param {string} id
 * @param {string} message
 * @param {number} date
 * 
 * @returns {Promise<string>}
 */
async function signMessage(id, message, date) {
    console.log(`sign ${id}${message}${date}${currData.nickname}`);
    let data = new TextEncoder().encode(`${id}${message}${date}${currData.nickname}`);
    let signatureBuf = await window.crypto.subtle.sign(
        {
            name: "ECDSA",
            hash: {name: "SHA-384"},
        },
        currData.signKeyPair.privateKey,
        data
    );
    let signBin = String.fromCharCode.apply(null, new Uint8Array(signatureBuf));
    return btoa(signBin);
}

/*** PATH SERVER IMPLEMENTATION */

const pathServers = [];

// Point d'entrée qu'on donne au serveur de chemin. Il est possible
// que le chemin lui même ferme cette socket, ou que nous la fermions
// nous avant de recevoir des requettes.
const wsProposal = {
    /** @type {WebSocket | undefined} */
    wsConnection: undefined,
    /**
     * Variable valable uniquement pour l'entrée dans un salon.
     * @type {PeerConnection | undefined} 
     */
    connectionOffer: undefined,
    /** Identifiant du timeout qui va réallimenter le salon d'un point d'entré */
    feedLoop: 0,

    reset() {
        if (this.wsConnection !== undefined) {
            this.wsConnection.onclose = () => { };
            this.wsConnection.close();
            this.wsConnection = undefined;
        }

        if (this.connectionOffer !== undefined) {
            this.connectionOffer.close();
            this.connectionOffer = undefined;
        }

        clearTimeout(this.feedLoop);
        this.feedLoop = 0;
    }
}

/** @param {PeerConnection} pcAnswer */
function onAnswerCreated(pcAnswer) {
    return new Promise((resolve) => {
        console.log("answer created")
        if (wsProposal.wsConnection === undefined) return;
        console.log("enter answer created");

        if (wsProposal.connectionOffer !== undefined) {
            // On a besoin de cette offre qu'à la connexion.
            wsProposal.connectionOffer.close();
            wsProposal.connectionOffer = undefined;
        }

        pcAnswer.ondatachannel = e => {
            console.log("channel answer openned");
            onWsProposalAnswerOpened();
            pcAnswer.channel = e.channel;
            pcAnswer.channel.onmessage = onRTCChannelMessage;
            peerConnections.push(pcAnswer);
            console.log("resolve");
            resolve();
        }
        try {
            wsProposal.wsConnection
                .send(JSON.stringify(pcAnswer.localDescription));
        } catch {
            console.log("wsServer lost")
        }
    });
}

async function sendProposalToWSServer(roomName, serverPathUrl, action) {
    if (serverPathUrl === undefined) {
        const i = Math.floor(Math.random() * (pathServers.length - 1));
        serverPathUrl = pathServers[i];
    }

    let offer = '';
    if (action == "join") {
        console.log("create a join proposal, wait 10 seconds");
        onPrepareWsProposal();
        wsProposal.connectionOffer = await createOffer();
        wsProposal.connectionOffer.id = randomInt(99999);
        wsProposal.connectionOffer.channel.onmessage = onRTCChannelMessage;
        offer = JSON.stringify(wsProposal.connectionOffer.localDescription);
    }

    const msg = {
        action: action,
        room: roomName,
        offer,
    };

    return new Promise((resolve, reject) => {
        try {
            wsProposal.wsConnection = new WebSocket(serverPathUrl);
        } catch(error) {
            console.error(`ws connection to ${serverPathUrl} failed`, error);
            reject();
        }

        wsProposal.wsConnection.onclose = () => {
            console.log("on wsConnection close");
            wsProposal.wsConnection = undefined;
            if (peerConnections.length > idealMinimalNumberOfPeers) {
                wsProposal.feedLoop = setTimeout(() => {
                    sendProposalToWSServer(roomName, serverPathUrl, 'feed');
                }, 20000);
            } else {
                sendProposalToWSServer(roomName, serverPathUrl, 'feed');
            }
        };

        wsProposal.wsConnection.onopen = () => {
            wsProposal.wsConnection.onmessage = (evt) => {
                console.log("received path server message");
                let msg = JSON.parse(evt.data);
                if (msg.mtype == "offer") {
                    console.log("received an offer");
                    createAnswer(JSON.parse(msg.data))
                        .then(onAnswerCreated)
                        .then(() => resolve(serverPathUrl));
                } else {
                    wsProposal.connectionOffer.channel.onopen = () => {
                        console.log("channel offer openned");
                        peerConnections.push(wsProposal.connectionOffer);
                        wsProposal.connectionOffer = undefined;
                        resolve(serverPathUrl);
                    };
                    console.log("set remote description", msg.data);
                    let remoteDesc;
                    try {
                        remoteDesc = JSON.parse(msg.data);
                    } catch {
                        console.error("unexpected remote description %o", msg.data);
                        return;
                    }
                    wsProposal.connectionOffer
                        .setRemoteDescription(remoteDesc)
                        .then(() => {
                            onConnectionToRoomDone();
                        });
                }
            };
            console.log("send offer");
            onSendWsProposal();
            wsProposal.wsConnection.send(JSON.stringify(msg));

            wsProposal.feedLoop = setTimeout(() => {
                if (wsProposal.wsConnection === undefined ||
                    wsProposal.wsConnection.readyState !== WebSocket.OPEN) {
                    return;
                }
                wsProposal.wsConnection.close();
            }, 30000);
        };
    });
}

/**
 * Join a room. Send a webRTC proposal to a server and keep a websocket
 * connection with the server since nobody connected.
 * 
 * Rejoint un salon de discussion et retourne le path server
 * utilisé dans une promesse.
 * @param {string} roomName 
 * @param {string | undefined} pathServerUrl 
 * @returns {Promise<string>}
 */
function joinRoom(roomName, pathServerUrl) {
    wsProposal.reset();
    return sendProposalToWSServer(roomName, pathServerUrl, 'join');
}

/**
 * Add a server path to create the rooms
 * @param {*} path 
 */
function addPath(path) {
    pathServers.push(path);
}

/*** PEER IMPLEMENTATION */

const peerConnectionCalls = [];
/* TODO: temporary put the call proposals in another container. Add a system
of cancellation */

function banPeer(fn) {
    let i = peerConnections.findIndex(fn);
    if (i < 0) return;
    peerConnections[i].close();
    for (; i < peerConnections.length - 1;)
        peerConnections[i] = peerConnections[++i];
    peerConnections.pop();
}

function banPeerByChannelId(channelId) {
    banPeer(pc => pc.channel.id == channelId);
}

function closePeers() {
    while (peerConnections.length > 0) {
        const pc = peerConnections.pop();
        pc.close();
    }
}


/*** PROPOSAL IMPLEMENTATION */

/**
 * @typedef ConnectionProposal
 * @property {string} id
 * @property {string} peerId Peer UUID
 * @property {string[]} channels channel's labels path from source of offer to latest.
 * @property {number} ttl Limite d'expiration, decrémente à chaque passage d'un pair à l'autre
 * @property {number} date Date d'expiration. L'offre ou la réponse se fermeront si cette date est dépassée.
 * @property {RTCSessionDescription} content Offre ou réponse sous format text.
 */

/**
 * On received a connection proposal from the mesh. We decide or not to
 * accept, forward or dismiss it.
 * 
 * @see {createConnectionProposals}
 * @see {onProposalAcceptedReceived}
 * 
 * @param {RTCDataChannel} currChannel
 * @param {ConnectionProposal} data 
 */
function onConnectionProposalReceived(data, currChannel, setMessageRooting) {
    console.log("connection proposal received");

    /* Dismiss if Date < now. The data.date is an expiration information.
        The sender of the proposal would have already removed the proposal */
    if (data.date < Date.now()) return;

    const remotePeerId = data.peerId;

    /* Conditions of acceptance: the peer should be farther than 1 (not a direct connection).
        If we are not currently connected to the peer (refer to the currData.connectedPeerIds).
        If we don't have the ideal number of peers connections, we can accept it. Otherwise,
        we choose randomly to accept or not. */
    const accept = data.channels.length > 1 && !currData.connectedPeerIds.has(remotePeerId)
        && (Math.random() > 0.5 || peerConnections.length < idealMinimalNumberOfPeers);

    if (accept) {
        console.log("accept proposal");
        if (peerConnections.length >= idealPeerConnectionNumber) {
            /* Close oldest connection if we overflow maximum
                idealPeerConnectionNumber */
            peerConnections.shift().close();
        }
        acceptProposal().then(console.log("accepted proposal sent"));
    } else if (--data.ttl > 0 && peerConnections.length >= 2) {
        console.log("refuse proposal");
        data.channels.push(currChannel.label);
        let rand = peerConnections.length == 2
            ? 0
            : randomInt(0, peerConnections.length - 1);
        if (peerConnections[rand].channel.label == currChannel.label) {
            rand++;
        }
        let msg = {
            path: rootConnectionProposal,
            args: data,
        };
        try {
            peerConnections[rand].channel.send(JSON.stringify(msg));
        } catch {
            peerConnections.clise(peerConnections[rand].id);
        }
    }

    /**
     * Accept the proposal. The remote will possibly enter in the
     * `onProposalAcceptedReceived` function.
     * 
     * @see {onProposalAcceptedReceived}
     */
    async function acceptProposal() {
        const answer = await createAnswer(JSON.parse(data.content));
        const id = randomInt(99999); /* TODO: replace with UUID */
        answer.id = id;
        proposalsPeerConnections.push(answer);

        /* Remove the answer once the original proposal has expired */
        const expirationTimeout = setTimeout(() => {
            answer.close();
            proposalsPeerConnections.remove(id);
        }, data.date - Date.now());

        /* On data channel, this means that we're connected to the
            remote peer */
        answer.ondatachannel = e => {
            clearTimeout(expirationTimeout);
            setMessageRooting(answer, e.channel);
            currData.connectedPeerIds.add(remotePeerId);
            e.channel.onclose = _ => {
                console.log(`peer connection ${id} close`);
                peerConnections.close(id);
                if (peerConnections.length == 0) {
                    onPeerConnectionsLost();
                }

                currData.connectedPeerIds.remove(remotePeerId);
                createConnectionProposals(setMessageRooting);
            };
            proposalsPeerConnections.remove(id);
            peerConnections.push(answer);
        };

        data.peerId = currData.peerId;
        data.channels.pop();
        data.content = JSON.stringify(answer.localDescription);

        const msg = {
            path: rootProposalAccepted,
            args: data,
        };
        currChannel.send(JSON.stringify(msg));
    }
}

/**
 * On reçoit du résaux un proposition accepté, on peut faire en sorte de
 * se connecter directement.
 * @param {ConnectionProposal} data 
 */
function onProposalAcceptedReceived(data) {
    console.log("enter on proposal accepted");
    if (data.date < Date.now() || currData.connectedPeerIds.has(data)) {
        return;
    }
    const peerConn = removeProposal(data.id);
    if (peerConn) {
        peerConn.setRemoteDescription(JSON.parse(data.content)).then(() => {
            console.log("proposal success");
            currData.connectedPeerIds.add(data);
            /* ??? peut être ajouter ici un mechanisme de promesse. Car il
                serait préférable que ça soit fait lorsque le channel s'ouvre.
                Celà dit, ça peut fonctionner, et c'est simple comme ça,
                alors attendont de voir si c'est stable */
        });
        return;
    }
    // Si on est pas le destinataire, on envoie au suivant dans la
    // pile des channels.
    const channelLabel = data.channels.pop();
    const previousPeerConnection = peerConnections.find(pc =>
        pc.channel.label == channelLabel);
    if (previousPeerConnection !== undefined) {
        const msg = {
            path: rootProposalAccepted,
            args: data
        };
        previousPeerConnection.channel.send(JSON.stringify(msg));
    }
}

/**
 * On reçoit du résaux une proposition d'appel audio. On va réponse oui en
 * envoyant une `answer` adaptée.
 * @param {CallProposal} data 
 * @param {RTCDataChannel} channel 
 */
function onCallProposalReceived(data, channel) {
    console.log("call proposal received");

    if (!(data.to === undefined || data.to == currData.nickname)) {
        console.log("forward call proposal");
        /* TODO: as we do with messages, send first an announcement
            then on request send the full message body
            thougth: there is a problem to solve. how many time, how many proposals
            should we keep in the local cache? */
        const msg = JSON.stringify({
            path: rootCallProposal,
            args: data
        });
        peerConnections.forEach(pc => pc.channel.send(msg));
        return;
    }

    async function _userCallAccepted() {
        let answer = await createAnswerWithAudio(data.offer);
        const msg = {
            path: rootCallProposalAccepted,
            args: {
                proposalId: data.id,
                answer: answer.localDescription
            }
        };
        if (data.encrypted) {
            msg.args.answer = await encryptWithKey(msg.args.answer, data.key);
        }
        channel.send(JSON.stringify(msg));
        peerConnectionCalls.push(answer);
    }

    if (data.encrypted) {
        if (data.key === undefined) {
            console.warn("call accepted: missing remote key in encrypted data");
            return;
        }
        decryptWithLocalKey(data.offer)
            .then(offer => JSON.parse(offer))
            .then(offer => {
                data.offer = offer;
                userAcceptCall(data.pseudo, () => {
                    _userCallAccepted().then(() => console.log("call accepted: success"))
                        .catch(err => console.error(`call accepted: error ${err}`));
                });
            })
            .catch(err => {
                console.warn(`call accepted: dismiss call destinated to ${data.to} because of failed to decrypt with local key.`)
                console.warn(err);
            });
    } else {
        userAcceptCall(data.pseudo, () => {
            _userCallAccepted().then(() => console.log("call accepted: success"))
                .catch(err => console.error(`call accepted: error ${err}`));
        });
    }
}

/**
 * On reçoit du résaux une réponse positive d'appel audio.
 * 
 * @param {{answer: RTCSessionDescription, proposalId: string}} data 
 */
function onCallProposalAcceptedReceived(data) {
    console.log("on call proposal accepted received");

    /* Look in our calls connections, if there I found a corresponding
        pc I can connect to it.
        If I don't find any corresponding connection I forward the message */

    for (pc of peerConnectionCalls) {
        if (pc.id == data.proposalId) {
            console.log("call: connect to remote");
            if (pc.encrypted) {
                decryptWithLocalKey(data.answer)
                    .then(answer => JSON.parse(answer))
                    .then(answer => pc.setRemoteDescription(answer))
                    .then(() => console.log("call: response handled"));
                delete pc.encrypted;
            } else {
                pc.setRemoteDescription(data.answer).then(() =>
                    console.log("call: response handled"));
            }
            return;
        }
    }

    console.log("call: forward proposal accepted");
    const msg = JSON.stringify({
        path: rootCallProposalAccepted,
        args: data
    });
    peerConnections.forEach(pc => pc.channel.send(msg))
}

/** 
 * Creates and send new propositions of webRTC connections into the mesh
 * through current connections.
 * 
 * ---
 * Créé et envoie de nouvelles propositions de connection dans le réseau
 * via les connections webRTC existantes.
 * 
 * @see {onConnectionProposalReceived}
 * @see {onProposalAcceptedReceived}
 */
async function createConnectionProposals(setMessageRooting) {
    console.log("enter create proposals");

    /* If a call too that function is already programmed, cancel it
        and process the function */
    if (createConnectionProposals.nextTimeout !== undefined) {
        /* ??? is it really what it does? Does the below line break that
            assumption?
            let newPeerConnections = await Promise.all(creations);
        */
        clearTimeout(createConnectionProposals.nextTimeout);
    }

    if (peerConnections.length == 0) {
        console.log("no peers connected - cancel peer connexion proposals");
        return;
    }

    if (peerConnections.length >= idealPeerConnectionNumber) return;

    // On commence par la création d'un nombre de proposition, on ne doit
    // pas dépasser le nombre idéal de connexion, propositions en cours
    // comprises. On limite le nombre de créations simultanée à 5, on reiterera
    // l'opération jusqu'à atteindre le but souhaité.
    const proposalsNumber = Math.min(Math.floor(
        (idealPeerConnectionNumber
            - peerConnections.length
            - proposalsPeerConnections.length)
    ), ceilLimitProposalCreation);

    let creations = [];
    for (let i = 0; i < proposalsNumber; ++i) {
        creations.push(createOffer());
    }

    /** @type {Array<PeerConnection>} */
    let newPeerConnections = await Promise.all(creations);

    // Pour chaque proposition, on incrémente un compteur, on initialise sa
    // durée de vie, son enregistrement quand il est ouvert, etc.
    
    for (/** @type {PeerConnection} */ pc of newPeerConnections) {
        pc.id = randomInt(99999); /* TODO: use UUID */

        if (peerConnections.length == 0) {
            console.log("no peers connected - cancel");
            return;
        }
        
        let rand = randomInt(peerConnections.length - 1);

        const msg = {
            path: rootConnectionProposal,
            args: {
                channels: [peerConnections[rand].channel.label],
                content: JSON.stringify(pc.localDescription),
                date: Date.now() + proposalLifeTimeMillis,
                id: pc.id,
                peerId: currData.peerId,
                ttl: idealTTL,
            }
        };

        const expirationTimeout = setTimeout(() => {
            /* pc.close();
            removeProposal(pc.id); */
        }, proposalLifeTimeMillis);

        /* On channel openned, it means that the connection is
            established */
        console.log(pc);
        pc.channel.onopen = _ => {
            console.log("proposal connection success, channel open", channel.id);
            clearTimeout(expirationTimeout);
            setMessageRooting(pc, pc.channel);
            peerConnections.push(pc);
            removeProposal(pc.id);
        };

        proposalsPeerConnections.push(pc);
        console.log("send proposal");
        peerConnections[rand].channel.send(JSON.stringify(msg));
    }

    createConnectionProposals.nextTimeout = setTimeout(_ => {
        createConnectionProposals.nextTimeout = undefined;
        createConnectionProposals(setMessageRooting);
    }, 30000);
}

/*** CONSTANTS */
 
/* Message type flags */

const rootMessageIdentifier = 0;
const rootMessageRequest = 1;
const rootMessageResponse = 2;
const rootConnectionProposal = 3;
const rootProposalAccepted = 4;
const rootCallProposal = 5;
const rootCallProposalAccepted = 6;

/*** ROOT IMPLEMENTATION */


/**
 * Je peux recevoir d'un peer un message.
 * @this {RTCDataChannel}
 * @param {MessageEvent} event
 */
function onRTCChannelMessage(event) {
    console.log("rtc message handle");
    const message = JSON.parse(event.data);
    RTCMessageRooter[message.path](message.args, this, (peerConnection, channel) => {
        peerConnection.channel = channel;
        channel.onmessage = onRTCChannelMessage;
    });
}

const RTCMessageRooter = [
    onMsgIdentifierReceived,
    onMsgRequestReceived,
    onMessageReceived,
    onConnectionProposalReceived,
    onProposalAcceptedReceived,
    onCallProposalReceived,
    onCallProposalAcceptedReceived,
];

/*** RTC TOOLS IMPLEMENTATION */

/** @type {RTCConfiguration} */
const webRTCConfig = {
    iceServers: [
        { /* accès temporaire pour le test. Ceci devra être renseigné par l'utilisateur
             ou bien on donnera un accès gratuit et limité. */
            urls: "turn:adalrozin.xyz:5349",
            username: "test",
            credential: "pwd",
        },
        {
            urls: "stun:adalrozin.xyz:3478",
        },
    ],
    iceCandidatePoolSize: 10,
};

let LOCAL_MEDIAS = undefined;

/**
 * Créer une connection avec une réponse dans localDescription 
 * @param {RTCSessionDescription} offer 
 * @returns {Promise<RTCPeerConnection>}
 */
async function createAnswer(offer) {
    return await new Promise((resolve) => {
        let peerConn = new RTCPeerConnection(webRTCConfig);
        peerConn.ondatachannel = e => {
            peerConn.channel = e.channel;
        };
        peerConn.setRemoteDescription(offer)
            .then(() => peerConn.createAnswer())
            .then(a => {
                peerConn.setLocalDescription(a);
            });
        peerConn.onicegatheringstatechange = ev => {
            if (ev.target.iceGatheringState === "complete") {
                resolve(peerConn);
            }
        };
    });
}

/**
 * Créer une connection avec une réponse dans localDescription 
 * @param {RTCSessionDescription} offer 
 * @returns {Promise<RTCPeerConnection>}
 */
async function createAnswerWithAudio(offer) {
    if (LOCAL_MEDIAS === undefined) {
        LOCAL_MEDIAS = await window.navigator
            .mediaDevices.getUserMedia({video: false, audio: true});
    }
    return await new Promise((resolve) => {
        let peerConn = new RTCPeerConnection(webRTCConfig);
        // Juste on créer une defered promise afin d'attendre que le channel soit créé.
        let deferedResolve;
        let waiting = new Promise(resolve => deferedResolve = resolve);
        peerConn.ondatachannel = e => {
            console.log("data channel open")
            e.channel.send(currData.nickname);
            e.channel.onmessage = (event) => { deferedResolve(event.data) };
        };
        LOCAL_MEDIAS.getTracks().forEach(track => {
            console.log("add track")
            peerConn.addTrack(track, LOCAL_MEDIAS);
        });
        peerConn.ontrack = (ev) => {
            console.log("fire on track");
            waiting.then((pseudo) => {
                console.log("show remote")
                let remoteMedias = new MediaStream();
                ev.streams[0].getTracks().forEach(track => remoteMedias.addTrack(track));
                let elt = getAudioElt(pseudo);
                if (elt != undefined) {
                    console.log("set remote medias")
                    elt.srcObject = remoteMedias;
                }
            });
        };
        peerConn.setRemoteDescription(offer)
            .then(() => peerConn.createAnswer())
            .then(a => {
                peerConn.setLocalDescription(a);
            });
        peerConn.onicegatheringstatechange = ev => {
            if (ev.target.iceGatheringState === "complete") {
                resolve(peerConn);
            }
        };
    });
}

/**
 * Creates a new offer and return it once it's valid for a remote connexion.
 * ---
 * Créé une nouvelle offre et la retourne dès qu'elle est valide pour une connexion
 * de l'exterieur.
 * 
 * @return {Promise<RTCPeerConnection>}
 */
async function createOffer() {
    let peerConn = new RTCPeerConnection(webRTCConfig);
    peerConn.channel = peerConn.createDataChannel(window.crypto.randomUUID());
    let offer = await peerConn.createOffer();
    await peerConn.setLocalDescription(offer);
    // A good offer take time to be created if you use stun
    // servers. 5000 ms are enough most of the time.
    return new Promise((resolve) => {
        peerConn.onicegatheringstatechange = ev => {
            if (ev.target.iceGatheringState === "complete") {
                resolve(peerConn);
            }
        };
    });
}

/**
 * Créer une nouvelle offre et la retourne en 500ms environ.
 * @return {Promise<RTCPeerConnection>}
 */
async function createOfferWithAudio() {
    let peerConn = new RTCPeerConnection(webRTCConfig);
    let channel = peerConn.createDataChannel(window.crypto.randomUUID());
    let deferedResolve;
    // L'offre met un peu plus de temps à recevoir les informations
    // du noeud distant. On annonce donc seulement lorsqu'on a créé
    // l'object audio + le channel est ouvert le message "ok". A sa
    // reception, le noeud distant va pouvoir créer l'audio de son
    // coté et nous aurons une impréssion de synchronisation
    let waiting = new Promise(resolve => deferedResolve = resolve);
    peerConn.channel = channel;
    channel.onmessage = (event) => {
        deferedResolve(event.data);
    };
    if (LOCAL_MEDIAS === undefined) {
        LOCAL_MEDIAS = await window.navigator
            .mediaDevices.getUserMedia({video: false, audio: true});
        
    }
    LOCAL_MEDIAS.getTracks().forEach(track => {
        console.log("add track")
        peerConn.addTrack(track, LOCAL_MEDIAS);
    });
    peerConn.ontrack = (ev) => {
        console.log("fire on track");
        
        waiting.then((pseudo) => {
            channel.send(currData.nickname);
            let remoteMedias = new MediaStream();
            ev.streams[0].getTracks().forEach(track => remoteMedias.addTrack(track));
            let elt = getAudioElt(pseudo);
            if (elt != undefined) {
                console.log("set medias")
                elt.srcObject = remoteMedias;
            }
        });
    };
    let offer = await peerConn.createOffer();
    await peerConn.setLocalDescription(offer);
    // A good offer take time to be created if you use stun
    // servers. 5000 ms are enough most of the time.
    return new Promise((resolve) => {
        peerConn.onicegatheringstatechange = ev => {
            if (ev.target.iceGatheringState === "complete") {
                resolve(peerConn);
            }
        };
    });
}

/*** LIB IMPLEMENTATION */

/**
 * Send a message 
 * @param {string} content
 * @param {undefined | {to: string, cryptokey: string}} privateMessageInfo Private massage informations
 *      (to: destinated to, key: crypto public key). Undefined otherwise. 
 */
async function send(content, privateMessageInfo) {

    const timestamp = Date.now();

    /** @type {ChatMessage} */
    const message = {
        id: window.crypto.randomUUID(),
        timestamp,
        content,
        nickname: currData.nickname,
    };

    if (privateMessageInfo) {
        let key;
        try {
            key = await importPeerCryptoKey(privateMessageInfo.cryptokey);
        } catch (err) {
            console.error(`failed to import bob key ${privateMessageInfo.to}`);
            throw err;
        }
        try {
            message.content = {
                to: privateMessageInfo.to,
                data: await encryptWithKey(content, key)
            };
            message.encrypted = true;
        } catch(err) {
            console.error(`failed to encrypt message for ${privateMessageInfo.to}`);
            throw err;
        }
    }

    if (currData.crypto) {
        message.signature = await signMessage(message.id,
            message.encrypted ? message.content.data : message.content,
            timestamp);
        message.pubkey = currData.signKeyPair.publicKey,
        message.cryptoKey = currData.cryptoKeyPair.publicKey
    }

    messagesReceived[message.id] = message;
    peerConnections.forEach(pc => {
        const msg = {
            path: rootMessageIdentifier,
            args: message.id,
        }
        try {
            pc.channel.send(JSON.stringify(msg));
        } catch {
            peerConnections.close(pc.id);
        }
    });
}

async function join(room, srv) {
    currData.joining = true;

    closePeers();

    // Une fois la connection sencée être établie, je lance
    // la boucle de proposals et de messages.
    console.log("all clear, joining the room", room);
    const pathServer = await joinRoom(room, srv);

    currData.pathServer = pathServer;
    currData.room = room;
    currData.joining = false;

    console.log("create proposal");
    createConnectionProposals((peerConnection, channel) => {
        peerConnection.channel = channel;
        channel.onmessage = onRTCChannelMessage;
    });
}

function setNickName(nickname) {
    currData.nickname = nickname;
}

/**
 * @param {(ChatMessage) => {}} handleMessageFunction 
 * 
 * TODO: remove that function and prefer the pure overrides method.
 */
function setOnMessages(handleMessageFunction) {
    onMessageIncoming = handleMessageFunction;
}

/**
 * @typedef CallProposal
 * @property {string} id
 * @property {string | undefined} to nickname who are the target. Anybody if undefined.
 * @property {string} peerId id of the local peer
 * @property {string} pseudo nickname of the local peer
 * @property {boolean | undefined} encrypted true if the offer is encrypted
 * @property {string} offer webRTC offer (encrypted if property `encrypted` is defined)
 * @property {string | undefined} key
 */

/**
 * Créé un appel audio avec un utilisateur sur le réseau.
 * @param {string} user
 * @param {undefined | string} cryptoKey
 */
function callUser(user, cryptoKey) {
    async function _startCall() {
        if (cryptoKey && currData.cryptoKeyPair.publicKey) {
            console.warn("start call: start a private call require to use keys itself");
            return;
        }
        if (peerConnections.length == 0) {
            console.warn("start call: nobody to call");
            return;   
        }
        /** @type {Array<RTCPeerConnection>} */
        let newPeerConnection = await createOfferWithAudio();
        newPeerConnection.id = window.crypto.randomUUID();

        let msg = {
            path: rootCallProposal,
            /** @type {CallProposal} */
            args: {
                to: user,
                peerId: currData.peerId,
                id: newPeerConnection.id,
                offer: newPeerConnection.localDescription,
                pseudo: currData.nickname
            }
        };

        if (cryptoKey) {
            newPeerConnection.encrypted = true;
            msg.args.offer = await encryptWithKey(
                JSON.stringify(newPeerConnection.localDescription),
                cryptoKey
            );
            msg.args.encrypted = true;
            msg.args.key = currData.cryptoKeyPair.publicKey;
        }

        msg = JSON.stringify(msg);

        peerConnections.forEach(pc => pc.channel.send(msg));
        peerConnectionCalls.push(newPeerConnection);
    }

    _startCall().then(() => console.log("start call: success"))
        .catch(err => console.error(`start call: ${err}`));
}
