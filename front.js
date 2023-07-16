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

function onWriting(e, _input) {
    const keyCode = e.which || e.keyCode;
    // 13 represents the Enter key
    if (keyCode === 13 && !e.shiftKey) {
        e.preventDefault();
        onMessageSubmit();
    }
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

function executeCommand(msg) {
    if (msg.value == "/help") {
        pushMessage("info: TODO", { className: "info" });
        return;
    }

    if (msg.value == "/call") {
        pushMessage("info: vous êtes sur le point de passer un appel audio." +
            " Cette fonctionnalité est encore en développement", { className: "info" });
        pushMessage("info: veuillez patienter, nous connectons les pairs entre eux. Celà peut prendre quelques secondes", { className: "info" });
        startCall();
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

    if (msg.value.startsWith("/usekeys")) {
        console.log("crypto", msg.value);
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
        console.log("crypto", msg.value);
        let keys = Object.keys(localStorage)
            .filter(i => i.startsWith("k-"))
            .map(i => i.replace("k-", ""));
        pushMessage(`${JSON.stringify(keys)}`, { className: "info" });
        return;
    }
}

function onMessageSubmit() {
    let msg = document.getElementById("messageTextArea");

    if (msg.value.length == 0) {
        return;
    }

    if (msg.value[0] == "/") {
        executeCommand(msg);
    } else {
        send(msg.value);
        pushMessage(`${currData.nickname}: ${msg.value}`);
    }

    msg.value = "";
}

const outputView = document.getElementById("outputView");

function pushMessage(msg, opt) {
    let newDiv = document.createElement('li');
    newDiv.innerText = msg;
    if (opt) {
        if (opt.data) {
            newDiv.data = opt.data;
            if (opt.data.verified == true) {
                newDiv.className = "signature_ok"
                // TODO: add a key button and call `saveMessageKeys` onclick
            } else if (opt.data.verified == false) {
                newDiv.className = "signature_nok"
            }
        }
        if (opt.className) {
            newDiv.className = opt.className;
        }
    }
    outputView.appendChild(newDiv);
    outputView.scrollTo(0, outputView.scrollHeight);
}

/**
 * On click to a signed message, we can save his public keys in the local
 * storage so we can recognize him rather mistake him with another guy with
 * the same nickname. Moreover, we can now send a private message to him.
 */
function saveMessageKeys() {
    saveMessageKeys.contacts[this.data.peers_keys_id]
        = peersKeys[this.data.peers_keys_id];
    localStorage.setItem("peers_keys", JSON.stringify(peersKeys));
}

/**
 * It's a temporary container of every peer's keys.
 */
const peersKeys = function init_peers_keys() {
    /* Initialize peers_keys */
    let ret = localStorage.getItem("peers_keys");
    if (ret == null) {
        saveMessageKeys.contacts = {};
        return {};
    }
    saveMessageKeys.contacts = ret;
    Object.values(ret).forEach(value => value.registred = true);
    return ret;
}();

peersKeys.findNickname = (nickname) => {
    return Object.values(peersKeys)
        .filter(peer => peer.nickname == nickname);
};

peersKeys.set = (key, value) => {
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
    let peers_keys_id = undefined;
    if (message.verified) {
        peers_keys_id = hash(message.pubkey);
        known = peersKeys.set(peers_keys_id, {
            cryptoKey: message.cryptoKey,
            pubkey: message.pubkey,
            nickname: message.nickname,
        });
    }

    let nickname = known
            && peersKeys[peers_keys_id].registred
            && message.nickname != peersKeys[peers_keys_id].nickname
        ? `${message.nickname} (${peersKeys[peers_keys_id].nickname})`
        : message.nickname;

    pushMessage(`${nickname}: ${message.content}`, {
        data: {
            peers_keys_id,
            verified: message.verified
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