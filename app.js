const disableIceTrickle = desc => desc.replace(/\r\na=ice-options:trickle/g, '');

const rtcRelay = (socketUrl) => {
    const connections = {};
    const socket = new WebSocket(socketUrl);

    const becomeHost = () => new Promise((resolve, reject) => {
        socket.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            if (data.type === 'HostResponse') {
                resolve(data.success);
            } else {
                reject();
            }
        };

        socket.send(JSON.stringify({
            type: "HostRequest"
        }));
    });

    const listenForConnections = () => {
        const channels = [];
        socket.onmessage = (msg) => {
            if (typeof(msg.data) === 'string' && msg.data.charAt(0) === '{') {
                const data = JSON.parse(msg.data);
                if (data.type === 'PeerRequest') {
                    const thing = new RTCPeerConnection({});
         
                    thing.onicecandidate = (e) => {
                        const offerMessage = {
                            type: "RTCOffer",
                            targetId: data.id,
                            offer: thing.localDescription
                        };
                        socket.send(JSON.stringify(offerMessage));
                    };
            
                    const dataChannel = thing.createDataChannel('homegames');
                    dataChannel.onopen = () => {
                        channels.push(dataChannel);
                    }
        
                    connections[data.id] = thing;
        
                    thing.createOffer().then((offer) => {
                        const replacedSDP = disableIceTrickle(offer.sdp);
                        offer.sdp = replacedSDP;
    
                        thing.setLocalDescription(offer);
                    });
        
                } else if (data.type === 'answer') {
                    const connection = connections[data.targetId];
    
                    if (connection.signalingState !== 'stable') {
                        connection.setRemoteDescription(new RTCSessionDescription(data.answer));
                    }
                } else {
                    this.onmessage && this.onmessage(msg.data);
                }
            } else {
                for (let channelIndex in channels) {
                    channels[channelIndex].send(msg.data)
                }
                this.onmessage && this.onmessage(msg.data);
            }
        };
    };

    const makePeerRequest = () => new Promise((resolve, reject) => {
        socket.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            if (data.type === 'offer') {
                const connection = new RTCPeerConnection({});
     
                connection.onicecandidate = (e) => {
                    socket.send(JSON.stringify(connection.localDescription));
                };

                connection.ondatachannel = (e) => {
                    const chan = e.channel || e;
                    chan.onmessage = (msg) => this.onmessage(msg.data);
                    resolve(true);
                };
    
                connection.setRemoteDescription(new RTCSessionDescription(data));
                connection.createAnswer().then((answer) => {
                    const replacedSDP = disableIceTrickle(answer.sdp);
                    answer.sdp = replacedSDP;

                    connection.setLocalDescription(answer);
                });
            }
        };
    
        socket.send(JSON.stringify({
            type: "PeerRequest"
        }));
    });


    socket.onopen = async () => {
        const isHost = await becomeHost();
        if (isHost) {
            listenForConnections();
            socket.send('ready');
            this.onopen();
        } else {
            makePeerRequest().then(success => {
                if (success) {
                    console.log("I OPENED THAT BOI");
                } else {
                    socket.send('ready');
                }
                this.onopen();
            });
        }
    };

    return this;
};

module.exports = rtcRelay;

