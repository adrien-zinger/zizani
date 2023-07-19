const outputView = document.getElementById("outputView");
const messageTextArea = document.getElementById("messageTextArea");
const messageSubmit = document.getElementById("messageSubmit");

/* Expands the connection form */
function addOptions() {
    if (addOptions.value === undefined) {
        let server = document.createElement('input');
        server.type = "text";
        server.id = "server"
        server.placeholder = "private server (optionnal)";
        document.getElementById('connectionForm').appendChild(server);
        addOptions.value = server;
    } else {
        addOptions.value.remove();
        addOptions.value = undefined;
    }
}

onWriting.state = "textinput";

function onWriting(e) {
    const keyCode = e.which || e.keyCode;
    // 13 represents the Enter key
    if (keyCode === 13 && !e.shiftKey) {
        e.preventDefault();
        onMessageSubmit();
    }
    console.log(messageTextArea.value.length > 0);
    messageSubmit.className = messageTextArea.value.length > 0 ? "send" : ""; 
}

function onKeyUp() {
    messageSubmit.className = messageTextArea.value.length > 0 ? "send" : ""; 
}

/**
 * Event when the user is on the login page and he press enter.
 *  */
function submitJoinRoom() {
    let roomElt = document.getElementById("room");
    let serverElt = document.getElementById("server");
    let serverValue = "wss://adalrozin.xyz:8532";
    if (serverElt !== null && serverElt.value === "")
        serverValue = serverElt.value;
    if (roomElt.value === "") {
        alert("Please enter a room name");
        return;
    }
    let pseudo = document.getElementById("pseudo");
    // Take nickname, save it into local storage.
    if (pseudo.value !== "") {
        setNickName(pseudo.value);
        localStorage.setItem("nickname", pseudo.value);
    }
    // Change url to keep current room and pseudo even
    // after a refresh.
    let url = new URL(window.location.href);
    url.searchParams.set("room", roomElt.value);
    window.history.pushState(
        null,
        "",
        url.href
    );
    console.log("join room");
    join(roomElt.value, serverValue);
    submitJoinRoom = () => { };
}

function hash(str) {
    var hash = 0, i, chr;
    for (i = 0; i < str.length; i++) {
        chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}


/* Override the empty functions of storage 

This is when you choose to use cryptography, you will produce
some keys and the will be stored (encrypted) somewhere. */

getKeysFromStorage = (id) => {
    let keys = localStorage.getItem(`k-${id}`);
    return keys ? keys : undefined;
}

setKeysToStorage = (id, keys) => {
    localStorage.setItem(`k-${id}`, keys);
}

/**
 * 
 * @param {{value: string}} msg 
 * @param {*} priv 
 * @returns 
 */
function executeCommand(msg, priv) {
    if (msg.value == "/help") {
        pushMessage("info: TODO", { className: "info" });
        return;
    }

    if (msg.value.startsWith("/call")) {
        let args = msg.value.split(' ');
        if (args.length == 2) {
            pushMessage("info: Please wait for remote user", { className: "info" });
            callUser(args[1]);
        } else {
            pushMessage("usage: /call <username>", { className: "info" })
        }
        return;
    }

    if (msg.value.startsWith("/nickname")) {
        let args = msg.value.split(' ');
        if (args.length == 2) {
            pushMessage("info: you're now " + args[1], { className: "info" })
            currData.nickname = args[1];
            localStorage.setItem("nickname", args[1]);
        } else {
            pushMessage("usage: /nickname <string>", { className: "info" })
        }
        return;
    }

    if (msg.value.startsWith("/addcontact")) {
        let args = msg.value.split(' ');
        if (args.length == 3) {
            addContact(args[2]);
        } else {
            pushMessage("usage: /addcontact <username> <id>", { className: "info" })
        }
        return;
    }

    if (msg.value.startsWith("/usekeys")) {
        let args = msg.value.split(' ');
        loadKeys(args[1], args[2]).then(() => {
            pushMessage(`info: you are currently using cryptography with ${args[1]}'s keys`, { className: "info" });
        }).catch((err) => {
            console.error(err);
            pushMessage(`warning: cannot load keys`, { className: "info" });
        });
        msg.value = "";
        pushMessage(`info: loading ${args[1]}'s keys...`, { className: "info" });
        return;
    }

    if (msg.value.startsWith("/listkeys")) {
        let keys = Object.keys(localStorage)
            .filter(i => i.startsWith("k-"))
            .map(i => i.replace("k-", ""));
        pushMessage(`${JSON.stringify(keys)}`, { className: "info" });
        return;
    }

    if (msg.value.startsWith("/privcall")) {
        let args = msg.value.split(' ');
        if (args.length == 2) {
            /** @type {Array<PeerKeys>} */
            let keys = peersKeys.findNickname(args[1]);
            if (keys.length == 0) {
                pushMessage(`error: no user named ${args[1]}`, { className: "info" });
                return;
            }
            if (keys.length > 1) {
                pushMessage(`error: multiple users are named ${args[1]}`, { className: "info" });
                return;
            }
            pushMessage("info: Please wait for remote user", { className: "info" });
            callUser(args[1], keys[0].cryptoKey);
        } else {
            pushMessage("usage: /privcall <username>", { className: "info" });
        }
        return;
    }

    if (msg.value.startsWith("/priv ")) {
        let args = msg.value.split(' ');
        if (args.length > 2) {
            /** @type {Array<PeerKeys>} */
            let keys = peersKeys.findNickname(args[1]);
            if (keys.length == 0) {
                pushMessage(`error: no user named ${args[1]}`, { className: "info" });
                return;
            }
            if (keys.length > 1) {
                pushMessage(`error: multiple users are named ${args[1]}`, { className: "info" });
                return;
            }
            let msg = messageTextArea.value.replace(args[0], '').replace(args[1], '').trim();
            send(msg, {to: args[1], cryptokey: keys[0].cryptoKey}).then(() => {
                console.log("onMessageSubmit: success");
            }).catch(err => {
                console.error(`onMessageSubmit: ${err}`);
            });
            pushMessage(`${currData.nickname}: ${msg}` /* TODO: private style */);
        } else {
            /* TODO: we should be able to send a private message to a group */
            pushMessage("usage: /priv <username>", { className: "info" });
        }
        return;
    }
}

function onMessageSubmit() {
    if (messageTextArea.value.length == 0) {
        return;
    }
    if (messageTextArea.value[0] == "/") {
        executeCommand(messageTextArea);
    } else {
        /* send message with zizani */
        send(messageTextArea.value).then(() => {
            console.log("onMessageSubmit: success");
        }).catch(err => {
            console.error(`onMessageSubmit: ${err}`);
        });
        pushMessage(`${currData.nickname}: ${messageTextArea.value}`);
    }

    messageTextArea.value = "";
}

function pushMessage(msg, opt) {
    let newMsg = document.createElement('li');
    if (opt) {
        let symbol = document.createElement('img');
        newMsg.append(symbol);

        if (opt.data) {
            if (opt.data.verified == true) {
                newMsg.onclick = proposeToSaveContact;
                newMsg.className = "signatureOk";
                newMsg.data = opt.data.peersKeysId;
                if (opt.data.warnContact) {
                    /* Signature valid but corresponds to a contact with same name
                        who isn't in contacts. */
                    newMsg.className += " warnContact";
                    newMsg.onclick = () => {
                        pushMessage("This user has an invalid signature. This user is probably"
                            + " trying to scam you.", { className: "info" });
                    };
                } else if (peersKeys[opt.data.peersKeysId].registred) {
                    newMsg.className += " knownPeer";
                } else {
                    newMsg.className += " unknownPeer";
                }

            } else if (opt.data.verified == false) {
                newMsg.className = "signatureNok";
                newMsg.onclick = () => {
                    pushMessage("This user has an invalid signature. This user is probably"
                        + " trying to scam you.", { className: "info" });
                };

            } else if (opt.data.warnContact) {
                newMsg.className = "warnContact";
                newMsg.onclick = () => {
                    pushMessage("This user hasn't signed his message but you know another"
                        + " contact with the same name.", { className: "info" });
                };
            }
        }
        if (opt.className) {
            newMsg.className = opt.className;
        }
    }

    newMsg.innerHTML += msg;
    outputView.appendChild(newMsg);
    outputView.scrollTo(0, outputView.scrollHeight);
}

/**
 * TODO: refacto. This isn't a functor anymore.
 */
function addContact(peerKeysId) {
    if (addContact.contacts[peerKeysId] === undefined) {
        addContact.contacts[peerKeysId] = peersKeys[peerKeysId];
        peersKeys[peerKeysId].registred = true;
        localStorage.setItem("peers_keys", JSON.stringify(addContact.contacts));
        pushMessage(`info: user ${peersKeys[peerKeysId].nickname} is registred in you local contacts`, { className: "info" });
    } else {
        pushMessage(`info: user ${peersKeys[peerKeysId].nickname} is already registred in you local contacts`, { className: "info" });
    }
}

function proposeToSaveContact() {
    const peer = peersKeys[this.data];
    if (peer) {
        if (addContact.contacts[this.data] === undefined) {
            pushMessage("Press enter to validate the command", { className: "info" });
            messageTextArea.value = `/addcontact ${peer.nickname} ${this.data}`;
        } else {
            pushMessage(`info: user ${peer.nickname} is already registred in you local contacts`, { className: "info" });
        }
    } else {
        pushMessage(`info: invalid peer informations`, { className: "info" });
    }
}

/**
 * It's a temporary container of every peer's keys.
 * @type {Array<PeerKeys>}
 */
const peersKeys = function init_peers_keys() {
    /* Initialize peers_keys */
    let ret = JSON.parse(localStorage.getItem("peers_keys"));
    if (ret == null) {
        addContact.contacts = {};
        return {};
    }
    addContact.contacts = JSON.parse(localStorage.getItem("peers_keys"));
    Object.values(ret).forEach(value => value.registred = true);
    return ret;
}();

/**
 * @typedef PeerKeys
 * @property {string} nickname
 * @property {string} pubkey
 * @property {string} cryptoKey
 * @property {Array<string>} othernames
 */

/**
 * @param {string} nickname 
 * @returns {Array<PeerKeys>}
 */
peersKeys.findNickname = (nickname) => {
    console.log("find nickname");
    return Object.values(peersKeys)
        .filter(peer => peer.nickname == nickname);
};

peersKeys.set = (key, value) => {
    console.log("add peer keys");
    if (peersKeys[key] === undefined) {
        peersKeys[key] = value;
        return false;
    } else if (peersKeys[key].nickname != value.nickname
        && peersKeys[key].cryptoKey == value.cryptoKey
        && peersKeys[key].pubkey == value.pubkey) {
        if (peersKeys[key].othernames == undefined) {
            peersKeys[key].othernames = [];
        }
        peersKeys[key].othernames.push(value.nickname);
    }
    return true;
};

setOnMessages((/** @type { ChatMessage } */ message) => {

    let known = false;
    let peersKeysId = undefined;
    /* Even if the message is ok (correct signature or just no signature);
        we want to warn the user if:
        1. The message come with the same nickname as another user that
            we had registred in our local contact. But with a different key.
        2. The message come without crypto and we have in our local contact
            someone with the same nickname. */
    let warnContact = false;
    if (message.verified === undefined) {
        warnContact = peersKeys.findNickname(message.nickname).length > 0;
    } else if (message.verified) {
        peersKeysId = hash(message.pubkey);
        known = peersKeys.set(peersKeysId, {
            cryptoKey: message.cryptoKey,
            pubkey: message.pubkey,
            nickname: message.nickname,
        });
        warnContact = !known && peersKeys.findNickname(message.nickname).length > 0;
    }

    let nickname = known
            && peersKeys[peersKeysId].registred
            && message.nickname != peersKeys[peersKeysId].nickname
        ? `${message.nickname} (${peersKeys[peersKeysId].nickname})`
        : message.nickname;

    pushMessage(`${nickname}: ${message.content}`, {
        data: {
            peersKeysId,
            verified: message.verified,
            nickname,
            warnContact
        }
    });
});

/**
 * Status of the view.
 *  - 0: idle (initially and after the connexion lost)
 *  - 1: proposal sent once
 *  - 2: connected
 *  - 3: connection lost
*/
let statusView = 0;

onPrepareWsProposal = () => {
    document.getElementById("connectionForm").style.display = "none";
    document.getElementById("roomView").style.display = "inline-block";
    pushMessage(`info: welcome ${currData.nickname}`, { className: "info" });
    pushMessage(`You can use command \\help to show the current features`, { className: "info" });

    onPrepareWsProposal = () => {}; // react to onPrepareWsProposal only once
};

onSendWsProposal = () => {
    if (statusView == 0) {
        pushMessage("info: you're currently alone in the room", { className: "info" });
        statusView = 1;
    }
};

/** Afficher que le client est connecté */
function activateRoom() {
    pushMessage(`info: connected to room ${currData.room}`, { className: "info" });
    statusView = 2;
}

onConnectionToRoomDone = () => {
    if (statusView == 1) {
        activateRoom();
    } else {
        console.error(`invalid event corresponding to status ${statusView} (expected 1)`);
    }
};

onWsProposalAnswerOpened = () => {
    if (statusView == 1) {
        activateRoom();
    } else {
        console.error(`invalid event corresponding to status ${statusView} (expected 1)`);
    }
};

onPeerConnectionsLost = () => {
    if (statusView == 2) {
        pushMessage("info: the connection to the room has been closed", { className: "info" });
        statusView = 0;
    } else {
        console.error(`invalid event corresponding to status ${statusView} (expected 2)`);
    }
}

userAcceptCall = (pseudo, callback) => {
    if (userAcceptCall.accepted) {
        callback();
    } else if (userAcceptCall.data[pseudo] === undefined) {
        userAcceptCall.data[pseudo] = true;
        let button = document.createElement('button');
        button.innerHTML = "Accepter les appels entrant de " + pseudo;
        button.onclick = () => {
            userAcceptCall.accepted = true;
            callback();
            button.remove();
            pushMessage("info: vous avez accepté les appels entrants", { className: "info" });
        }
        outputView.append(button);
    }
};

userAcceptCall.data = {};

getAudioElt = (label) => {
    console.log("create audio elt");
    let audio = document.createElement('audio');
    let mute = document.createElement('button');
    let volume = document.createElement('input');
    let pseudo = document.createElement('p');
    pseudo.innerHTML = label;
    let ctnr = document.createElement('div');
    volume.type = "range";
    volume.max = 100;
    volume.value = 100;
    audio.autoplay = true;
    let play = true;
    mute.onclick = () => {
        if (play) {
            console.log("pause");
            audio.pause();
            play = false;
        } else {
            audio.play().then(() => console.log("play"));
            play = true;
        }
    };
    volume.oninput = (e) => {
        audio.volume = e.target.value / 100;
    };
    mute.innerText = "mute";
    ctnr.appendChild(pseudo);
    ctnr.appendChild(audio);
    ctnr.appendChild(mute);
    ctnr.appendChild(volume);
    outputView.appendChild(ctnr);
    return audio;
};

window.onload = () => {
    console.log("on load")
    const params = new URLSearchParams(window.location.search);
    let nickname = localStorage.getItem("nickname");
    // Set nickname and if we are on the first page, set the
    // pseudo value too.
    if (params && params.get("nickname")) {
        let nickname = params.get("nickname");
        setNickName(nickname);
        const pseudo = document.getElementById("pseudo");
        if (pseudo) {
            pseudo.value = nickname;
        }
    } else if (nickname) {
        setNickName(nickname);
        const pseudo = document.getElementById("pseudo");
        if (pseudo) {
            pseudo.value = nickname;
        }
    }
    if (params) {
        // TODO: manage other servers.
        let serverValue = "wss://adalrozin.xyz:8532";
        console.log("params", params)
        if (params.get("room")) {
            console.log("join")
            join(params.get("room"), serverValue);
            return;
        }
    }
    document.getElementById("connectionForm").style.display = "block";
};