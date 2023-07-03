/* Expands the connection form */
function addOptions() {
    if (addOptions.value === undefined) {
        let server = document.createElement('input');
        server.type = "text";
        server.id = "server"
        server.placeholder = "chemin (optionnel)";
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

function submitJoinRoom() {
    let roomElt = document.getElementById("room");
    let serverElt = document.getElementById("server");
    let serverValue = "wss://adalrozin.xyz:8532";
    if (serverElt !== null && serverElt.value === "")
        serverValue = serverElt.value;
    if (roomElt.value === "") {
        alert("Renseigner le salon est indispensable");
        return;
    }
    let pseudo = document.getElementById("pseudo");
    if (pseudo.value !== "")
        setNickName(pseudo.value);
    // Change url to keep current room and pseudo even
    // after a refresh.
    window.history.replaceState(
        null,
        "",
        `${window.location.href}?room=${roomElt.value}`
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
    let keys = localStorage.getItem(id);
    return keys ? keys : undefined;
}

setKeysToStorage = (id, keys) => {
    localStorage.setItem(id, keys);
}

function onMessageSubmit() {
    let msg = document.getElementById("messageTextArea");
    if (msg.value === "/call") {
        msg.value = "";
        pushMessage("info: vous êtes sur le point de passer un appel audio." +
            " Cette fonctionnalité est encore en développement", "info");
        pushMessage("info: veuillez patienter, nous connectons les pairs entre eux. Celà peut prendre quelques secondes", "info");
        startCall();
        return;
    }

    if (msg.value.startsWith("/usekeys")) {
        console.log("crypto", msg.value);
        let args = msg.value.split(' ');
        loadKeys(args[1], args[2]).then(() => {
            pushMessage(`info: you are currently using cryptography with ${args[1]}'s keys`, "info");
        }).catch((err) => {
            console.error(err);
            pushMessage(`info: cannot load keys`, "info");
        });
        msg.value = "";
        pushMessage(`info: loading ${args[1]}'s keys`, "info");
        return;
    }

    send(msg.value);
    pushMessage(`moi: ${msg.value}`);
    msg.value = "";
}

const outputView = document.getElementById("outputView");

function pushMessage(msg, opt) {
    let newDiv = document.createElement('li');
    newDiv.innerText = msg;
    if (opt) {
        if (opt.data) {
            newDiv.data = opt.data;
        }
        if (opt.className) {
            newDiv.className = opt.className;
        }
    }
    outputView.appendChild(newDiv);
}


setOnMessages((/** @type { ChatMessage } */ message) => {
    pushMessage(`${message.nickname}: ${message.content}`, {
        data: {
            epubkey: message.epubkey,
            pubkey: message.pubkey,
        }
    });
});

let statusView = 0; // idle

onPrepareWsProposal = () => {
    document.getElementById("connectionForm").style.display = "none";
    document.getElementById("roomView").style.display = "inline-block";
    pushMessage("info: recherche du salon", { className: "info" });
    pushMessage(`info: vous pouvez passer des appels vocaux avec vos collaborateurs \
    en utilisant la commande '/call', cette fonctionnalité est encore en phase de test`, { className: "info" });
};

onSendWsProposal = () => {
    if (statusView != 1) {
        pushMessage("info: attente des participants", { className: "info" });
        onSendWsProposal = () => {}; // Print message just once 
    }
};

/** Afficher que le client est connecté */
function activateRoom() {
    pushMessage("info: vous êtes connecté", { className: "info" });
}

onConnectionToRoomDone = () => {
    if (statusView != 1) {
        activateRoom();
        statusView = 1;
    }
};

onWsProposalAnswerOpened = () => {
    if (statusView != 1) {
        activateRoom();
        statusView = 1;
    }
};

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
    if (params) {
        let serverValue = "wss://adalrozin.xyz:8532";
        console.log("params", params)
        if (params.get("room")) {
            console.log("join")
            join(params.get("room"), serverValue);
        }
        // TODO: load pseudo from cache
    }
};