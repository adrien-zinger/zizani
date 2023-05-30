/*** CRYPTO IMPLEMENTATION */

const randomUUID = window.crypto.randomUUID;

const keyPair = {
    /** @type {CryptoKey} */
    publicKey: undefined,
    privateKey: undefined
};

function randomInt(max) {
    return Math.floor(Math.random() * max);
}

/**
 * @return {Promise<CryptoKeyPair>}
 */
const generateKeyPair = async () => {
    /** @type {CryptoKeyPair} */
    let { privateKey, publicKey } = await window.crypto.subtle.generateKey(
        {
            name: "ECDSA",
            namedCurve: "P-384"
        },
        true,
        ["sign", "verify"]
    );

    keyPair.publicKey = window.crypto.subtle.exportKey("spki", publicKey);
    keyPair.privateKey = privateKey;
};

generateKeyPair().then(() => console.log("keys generated"));

const sign = window.crypto.subtle.sign;
const verify = window.crypto.subtle.verify;


/****** MESSAGES IMPLEMENTATION */

/**
 * @typedef {Object} ChatMessage
 * @property {string} id
 * @property {number} timestamp
 * @property {string} content
 * @property {string} signature
 * @property {string} pubkey
 */

const messagesReceived = {};

/** function called when a message is received from the mesh */
let onMessageIncoming = () => { };
let onPrepareWsProposal = () => { };
let onSendWsProposal = () => { };
let onWsProposalAnswerOpened = () => { };
let onConnectionToRoomDone = () => { };
let getAudioElt = () => { };

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
    if (messagesReceived[id] === undefined) {
        // Je ferme la connexion si on me demande quelque
        // chose que je ne connais pas car ça ne devrait pas
        // arriver.
        return currChannel.close();
    }
    const msg = {
        path: rootMessageResponse,
        args: message,
    }
    currChannel.send(JSON.stringify(msg));
}

/**
* @param {ChatMessage} chatMessage
* @param {RTCDataChannel} currChannel
*/
function onMessageReceived(chatMessage, currChannel) {
    /*
    if (chatMessage.pubkey === undefined ||
        chatMessage.signature === undefined) {
        console.log("invalid signature");
        banPeerByChannelId(currChannel.id);
        return;
    }

    const pubkey = window.crypto.subtle.importKey(chatMessage.pubkey);
    
    if (!verify(null,
        chatMessage.id + chatMessage.timestamp + chatMessage.content,
        pubkey,
        Buffer.from(chatMessage.signature, 'hex'))) {
        console.log("invalid signature");
        banPeerByChannelId(currChannel.id);
        return;
    }
    */

    if (messagesReceived[chatMessage.id] !== undefined) {
        return;
    }

    console.log(chatMessage);
    onMessageIncoming(chatMessage);
    messagesReceived[chatMessage.id] = chatMessage;
    /** @type {[]} */
    let channelsIdsThatKnow = messagesInfo.channelsKnowId(chatMessage.id);
    messagesInfo.delete(chatMessage.id);

    // Une fois reçu, je peux forward à tout mon entourage
    // l'id du message.
    peerConnections.forEach(pc => {
        if (channelsIdsThatKnow.includes(pc.channel.id)) return;
        const msg = {
            path: rootMessageIdentifier,
            args: chatMessage.id,
        };
        pc.channel.send(JSON.stringify(msg));
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
            banPeerByChannelId(channel.id);
            tryPull();
        }, 200);
    };

    tryPull();
}

function sendMessage(content) {
    if (keyPair.privateKey == null || keyPair.publicKey == null) {
        console.log("warn, key pair hasn't been generated");
        return;
    }
    const message = {
        id: window.crypto.randomUUID(),
        timestamp: Date.now(),
        content,
        pubkey: keyPair.publicKey,
    };

    //message.signature = window.crypto.subtle.sign(null,
    //    keyPair.privateKey,
    //    new TextEncoder().encode(`${message.id}${message.timestamp}${message.content}`))
    //.toString('hex');
    messagesReceived[message.id] = message;
    peerConnections.forEach(pc => {
        const msg = {
            path: rootMessageIdentifier,
            args: message.id,
        }
        try {
            pc.channel.send(JSON.stringify(msg));
        } catch {
            banPeerById(pc.id);
        }
    });
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

/**
 * @typedef {RTCPeerConnection & {channel: RTCDataChannel, id: number}} PeerConnection
 */

/** @type {Array<PeerConnection>} */
const peerConnections = [];
const peerConnectionCalls = [];

function banPeer(fn) {
    let i = peerConnections.findIndex(fn);
    if (i < 0) return;
    for (; i < peerConnections.length - 1;)
        peerConnections[i] = peerConnections[++i];
    peerConnections.pop();
}

function banPeerByChannelId(channelId) {
    banPeer(pc => pc.channel.id == channelId);
}

function banPeerById(id) {
    banPeer(pc => pc.id == id);
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
 * @property {string[]} channels channel's labels path from source of offer to latest.
 * @property {number} ttl Limite d'expiration, decrémente à chaque passage d'un pair à l'autre
 * @property {number} date Date d'expiration. L'offre ou la réponse se fermeront si cette date est dépassée.
 * @property {RTCSessionDescription} content Offre ou réponse sous format text.
 */

const idealPeerConnectionNumber = 20;
const idealMinimalNumberOfPeers = 5;

const proposalLifeTimeMillis = 10000;

const ceilLimitProposalCreation = 5;
const idealTTL = 32;

const proposalsPeerConnections = [];

/**
 * Retire la proposition de la liste et renvoie cette proposition.
 * @param {number} id peer connection id
 * @returns {import('./peers').PeerConnection | null}
 */
function removeProposal(id) {
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
 * @param {RTCDataChannel} currChannel
 * @param {ConnectionProposal} data 
 */
function onConnectionProposalReceived(data, currChannel, setMessageRooting) {
    console.log("connection proposal received");
    if (data.date < Date.now()) return;

    if ((Math.random() > 0.5 || peerConnections.length < idealMinimalNumberOfPeers) &&
        data.channels.length > 1) {

        console.log("accept proposal");
        if (peerConnections.length >= idealPeerConnectionNumber) {
            const oldestConnection = peerConnections.shift();
            oldestConnection.close();
        }
        createAnswer(JSON.parse(data.content)).then(pcAnswer => {
            pcAnswer.id = randomInt(99999);
            proposalsPeerConnections.push(pcAnswer);

            const expirationTimeout = setTimeout(() => {
                pcAnswer.close();
                removeProposal(pcAnswer.id);
            }, data.date - Date.now());

            pcAnswer.ondatachannel = e => {
                clearTimeout(expirationTimeout);
                setMessageRooting(pcAnswer, e.channel);
                e.channel.onclose = _ => createProposals(setMessageRooting);
                removeProposal(pcAnswer.id);
                peerConnections.push(pcAnswer);
            };

            data.channels.pop();
            data.content = JSON.stringify(pcAnswer.localDescription);

            const msg = {
                path: rootProposalAccepted,
                args: data,
            };
            currChannel.send(JSON.stringify(msg));
        });
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
            banPeerById(peerConnections[rand].id);
        }
    }
}

/**
 * On reçoit du résaux un proposition accepté, on peut faire en sorte de
 * se connecter directement.
 * @param {ConnectionProposal} data 
 */
function onProposalAcceptedReceived(data) {
    console.log("enter on proposal accepted");
    if (data.date < Date.now()) return;
    const peerConn = removeProposal(data.id);
    if (peerConn) {
        peerConn.setRemoteDescription(JSON.parse(data.content)).then(() => {
            console.log("proposal success");
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
 * @param {{offer: RTCSessionDescription, channelLabel: string} data 
 * @param {RTCDataChannel} channel 
 */
function onCallProposalReceived(data, channel) {
    console.log("call proposal received");

    createAnswerWithAudio(data.offer).then(answer => {
        const msg = {
            path: rootCallProposalAccepted,
            args: {answer: answer.localDescription, channelLabel: data.channelLabel}
        }
        channel.send(JSON.stringify(msg));
        peerConnections.push(answer);
    });
}

/**
 * On reçoit du résaux une proposition d'appel audio. On va réponse oui en
 * envoyant une `answer` adaptée.
 * @param {{answer: RTCSessionDescription, channelLabel: string}} data 
 */
function onCallProposalAccepted(data) {
    console.log("on call proposal accepted");
    peerConnectionCalls.forEach(pc => {
        if (pc.channel.label == data.channelLabel) {
            console.log("call running");
            pc.setRemoteDescription(data.answer)
                .then(() => console.log("call response handled"));
        }
    });
}

/**
 * Créer et envoie de nouvelles propositions de connection dans le réseau
 * si besoin.
 */
async function createProposals(setMessageRooting) {
    console.log("enter create proposals");
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
    if (peerConnections.length == 0) {
        return;
    }
    const currPCLength = peerConnections.length - 1;
    newPeerConnections.forEach((/** @type {PeerConnection} */ pc) => {
        pc.id = randomInt(99999);

        let rand = randomInt(currPCLength);
        let guard = 100;

        while (peerConnections[rand] === undefined) {
            rand = randomInt(currPCLength);
            if (guard-- == 0) return; // TODO: return an error
        }

        const msg = {
            path: rootConnectionProposal,
            args: {
                channels: [peerConnections[rand].channel.label],
                content: JSON.stringify(pc.localDescription),
                date: Date.now() + proposalLifeTimeMillis,
                id: pc.id,
                ttl: idealTTL,
            }
        };

        const expirationTimeout = setTimeout(() => {
            pc.close();
            removeProposal(pc.id);
        }, proposalLifeTimeMillis);

        pc.channel.onopen = _ => {
            clearTimeout(expirationTimeout);
            setMessageRooting(pc, pc.channel);
            peerConnections.push(pc);
            removeProposal(pc.id);
        };

        proposalsPeerConnections.push(pc);
        console.log("send proposal");
        peerConnections[rand].channel.send(JSON.stringify(msg));
    });

    setTimeout(_ => createProposals(setMessageRooting), 30000);
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
    onCallProposalAccepted,
];

/*** RTC TOOLS IMPLEMENTATION */

/** @type {RTCConfiguration} */
const webRTCConfig = {
    iceServers: [
        {
            urls: "stun:stun.12voip.com:3478"
        },
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
        setTimeout(() => resolve(peerConn), 5000);
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
            e.channel.onmessage = () => { deferedResolve() };
        };
        LOCAL_MEDIAS.getTracks().forEach(track => {
            console.log("add track")
            peerConn.addTrack(track, LOCAL_MEDIAS);
        });
        peerConn.ontrack = (ev) => {
            console.log("fire on track");
            waiting.then(() => {
                console.log("show remote")
                let remoteMedias = new MediaStream();
                ev.streams[0].getTracks().forEach(track => remoteMedias.addTrack(track));
                let elt = getAudioElt();
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
        setTimeout(() => resolve(peerConn), 5000);
    });
}

/**
 * Créer une nouvelle offre et la retourne en 500ms environ.
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
        setTimeout(() => {
            resolve(peerConn);
        }, 5000);
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
    channel.onopen = () => {
        deferedResolve();
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
        let remoteMedias = new MediaStream();
        ev.streams[0].getTracks().forEach(track => remoteMedias.addTrack(track));
        let elt = getAudioElt();
        if (elt != undefined) {
            console.log("set medias")
            elt.srcObject = remoteMedias;
        }
        waiting.then(() => channel.send("ok"));
    };
    let offer = await peerConn.createOffer();
    await peerConn.setLocalDescription(offer);
    // A good offer take time to be created if you use stun
    // servers. 5000 ms are enough most of the time.
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(peerConn);
        }, 5000);
    });
}

/*** LIB IMPLEMENTATION */

const currData = {
    joining: false,
    room: '',
    proposalLoop: 0,
    pathServer: '',
    nickname: 'anonymous',
    onMessage(messages) {
        console.log(messages.pop());
    },
};

/**
 * Send a message 
 * @param {string} msg 
 */
function send(msg) {
    sendMessage(`${currData.nickname}: ${msg}`)
}

async function join(room, srv) {
    currData.joining = true;
    clearInterval(currData.proposalLoop);

    closePeers();

    // Une fois la connection sencée être établie, je lance
    // la boucle de proposals et de messages.
    console.log("all clear, joining the room", room);
    const pathServer = await joinRoom(room, srv);

    currData.pathServer = pathServer;
    currData.room = room;
    currData.joining = false;

    console.log("create proposal");
    createProposals((peerConnection, channel) => {
        peerConnection.channel = channel;
        channel.onmessage = onRTCChannelMessage;
    });
}

function setNickName(nickname) {
    currData.nickname = nickname;
}

/**
 * @param {(ChatMessage) => {}} handleMessageFunction 
 */
function setOnMessages(handleMessageFunction) {
    onMessageIncoming = handleMessageFunction;
}

/**
 * Sert à créer des nouvelles offres pour chacun des noeuds auquels
 * je suis actuellement connecté afin de créer un appel audio.
 * 
 * Actuellement, la fonctionnalité est limité et risque d'avoir des
 * comportements indésirés avec de nombreuses personnes. Il faudrait
 * permettre de créer des cluster personnalisé en "invitant" dans des
 * channels privés.
 * 
 * Il faudrait aussi pouvoir gérer le nombre de personnes maximum
 * dans un réseau. Peut être y inclure du raft.
 */
async function startCallWithCurrentCluster() {
    /** @type {Array<RTCPeerConnection>} */
    let newPeerConnections = await Promise.all(peerConnections.map(_ => createOfferWithAudio()));
    let i = 0;
    peerConnections.map(/** @type {PeerConnection} */pc => {
        let newPc = newPeerConnections[i++];
        console.assert(newPc != undefined);
        console.assert(newPc.channel.label != undefined);
        const msg = {
            path: rootCallProposal,
            args: {
                channelLabel: newPc.channel.label,
                offer: newPc.localDescription,
            }
        }
        pc.channel.send(JSON.stringify(msg));
    });
    newPeerConnections.forEach(offer => peerConnectionCalls.push(offer));
}

function startCall() {
    startCallWithCurrentCluster().then(() => console.log("sending call"));
}
