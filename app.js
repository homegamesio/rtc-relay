class RTCRelay {
    constructor(socketUrl, onOpen, onMessage, binaryType, forceSocket = false) {
        this.connections = {};
        this.channels = [];
        this.onOpen = onOpen;
        this.onMessage = onMessage;
        this.socket = new WebSocket(socketUrl);
        this.binaryType = binaryType;
        this.transportType = null;

        if (this.binaryType) {
            this.socket.binaryType = this.binaryType;
        }

        this.socket.onopen = async () => {
            const isHost = await this.becomeHost();
            if (isHost) {
                this.listenForConnections();
                this.socket.send('ready');
                this.transportType = 'socket';
                this.onOpen && this.onOpen();
            } else {
                if (!forceSocket) {
                    this.makePeerRequest().then(success => {
                        if (!success) {
                            this.socket.send('ready');
                        }
    
                        this.transportType = success ? 'rtc' : 'socket';
                        this.onOpen && this.onOpen();
                    });
                } else {
                    this.socket.send('ready');
                    this.transportType = 'socket';
                    this.socket.onmessage = (msg) => {
                        this.onMessage && this.onMessage(msg.data);
                    };
                    this.onOpen && this.onOpen();

                }
            }
        };
    }
    
    disableIceTrickle(desc) {
        return desc.replace(/\r\na=ice-options:trickle/g, '');
    }

    becomeHost() { 
        return new Promise((resolve, reject) => {
            this.socket.onmessage = (msg) => {
                const data = JSON.parse(msg.data);
                if (data.type === 'HostResponse') {
                    resolve(data.success);
                } else {
                    reject();
                }
            };

            this.socket.send(JSON.stringify({
                type: "HostRequest"
            }));
        });
    }

    listenForConnections() {
        this.socket.onmessage = (msg) => {
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
                        this.socket.send(JSON.stringify(offerMessage));
                    };
            
                    const dataChannel = thing.createDataChannel('dataChannel');

                    dataChannel.onopen = () => {
                        this.channels.push(dataChannel);
                    }
        
                    this.connections[data.id] = thing;
        
                    thing.createOffer().then((offer) => {
                        const replacedSDP = this.disableIceTrickle(offer.sdp);
                        offer.sdp = replacedSDP;
    
                        thing.setLocalDescription(offer);
                    });
        
                } else if (data.type === 'answer') {
                    const connection = this.connections[data.targetId];
    
                    if (connection.signalingState !== 'stable') {
                        connection.setRemoteDescription(new RTCSessionDescription(data.answer));
                    }
                } else {
                    this.onMessage && this.onMessage(msg.data);
                }
            } else {
                for (let channelIndex in this.channels) {
                    if (this.channels[channelIndex].readyState === 'open') {
                        this.channels[channelIndex].send(msg.data);
                    } else {
                        delete this.channels[channelIndex];
                    }
                }
                this.onMessage && this.onMessage(msg.data);
            }
        };
    }

    makePeerRequest() {

        let channelInitTimeout;

        return new Promise((resolve, reject) => {
            this.socket.onmessage = (msg) => {
                const data = JSON.parse(msg.data);
                if (data.type === 'offer') {
                    const connection = new RTCPeerConnection({});
         
                    connection.onicecandidate = (e) => {
                        this.socket.send(JSON.stringify(connection.localDescription));
                    };

                    if (!channelInitTimeout) {
                        channelInitTimeout = setTimeout(() => {
                            console.warn("Timed out waiting for RTC data channel");
                            resolve(false);
                        }, 5000);
                    }
    
                    connection.ondatachannel = (e) => {
                        clearTimeout(channelInitTimeout);
                        const chan = e.channel || e;
    
                        if (this.binaryType) {
                            chan.binaryType = this.binaryType;
                        }

                        chan.onmessage = (msg) => {
                            this.onMessage && this.onMessage(msg.data);
                        };

                        resolve(true);
                    };
        
                    connection.setRemoteDescription(new RTCSessionDescription(data));
                    connection.createAnswer().then((answer) => {
                        const replacedSDP = this.disableIceTrickle(answer.sdp);
                        answer.sdp = replacedSDP;
    
                        connection.setLocalDescription(answer);
                    });
                }
            };
        
            this.socket.send(JSON.stringify({
                type: "PeerRequest"
            }));
        });
    }

    send(msg) {
        this.socket.send(msg);
    }

}

module.exports = RTCRelay;
