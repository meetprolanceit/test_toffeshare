// public/sender.js - IMPROVED VERSION WITH FLOW CONTROL
document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const fileInput = document.getElementById('fileInput');
    const createShareBtn = document.getElementById('createShareBtn');
    const shareInfo = document.getElementById('shareInfo');
    const shareLink = document.getElementById('shareLink');
    const copyBtn = document.getElementById('copyBtn');
    const connectionStatus = document.getElementById('connectionStatus');
    const transferStatus = document.getElementById('transferStatus');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    let file = null;
    let peers = new Map();
    let shareId = null;
    let activeTransfers = 0;

    // Create share link
    createShareBtn.addEventListener('click', () => {
        file = fileInput.files[0];
        if (!file) {
            alert('Please select a file first');
            return;
        }

        socket.emit('create-share', (id) => {
            shareId = id;
            const link = `${window.location.origin}/share/${id}`;
            shareLink.value = link;
            shareInfo.classList.remove('hidden');
            connectionStatus.textContent = 'Waiting for receivers to connect...';

            // Send file metadata to server
            const metadata = {
                name: file.name,
                size: file.size,
                type: file.type,
            };
            socket.emit('file-metadata', { shareId, metadata });
        });
    });

    // Copy link to clipboard
    copyBtn.addEventListener('click', () => {
        shareLink.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
            copyBtn.textContent = 'Copy';
        }, 2000);
    });

    // Handle receiver joining
    socket.on('receiver-joined', ({ receiverId, totalReceivers }) => {
        connectionStatus.textContent = `${totalReceivers} receiver(s) connected. Waiting for download requests...`;
    });

    // Handle download request from receiver
    socket.on('download-requested', ({ receiverId }) => {
        connectionStatus.textContent = `Receiver ${receiverId.substring(
            0,
            6
        )}... requested download. Establishing connection...`;

        // Create peer connection for this receiver
        const peer = new SimplePeer({
            initiator: true,
            trickle: false,
        });

        peers.set(receiverId, {
            peer,
            progress: 0,
            sending: false,
            chunkIndex: 0,
            totalChunks: 0,
        });

        activeTransfers++;

        // Update UI to show transfer status
        if (activeTransfers === 1) {
            transferStatus.classList.remove('hidden');
        }

        // Handle peer signals
        peer.on('signal', (data) => {
            socket.emit('signal', {
                to: receiverId,
                signal: data,
            });
        });

        // Handle peer connection
        peer.on('connect', () => {
            connectionStatus.textContent = `Connected to receiver ${receiverId.substring(
                0,
                6
            )}... Starting file transfer...`;

            // Send file metadata
            const metadata = {
                name: file.name,
                size: file.size,
                type: file.type,
            };

            peer.send(
                JSON.stringify({
                    type: 'metadata',
                    data: metadata,
                })
            );

            // Start file transfer
            sendFile(file, peer, receiverId);
        });

        peer.on('error', (err) => {
            console.log(`🚀 ~ peer.on ~ err:`, err);
            connectionStatus.textContent = `Connection error with receiver ${receiverId.substring(0, 6)}...: ${
                err.message
            }`;
            cleanupPeer(receiverId);
        });

        peer.on('close', () => {
            cleanupPeer(receiverId);
        });
    });

    // Handle incoming signals from receivers
    socket.on('signal', ({ from, signal }) => {
        const peerData = peers.get(from);
        if (peerData && peerData.peer) {
            try {
                peerData.peer.signal(signal);
            } catch (err) {
                console.error('Error signaling peer:', err);
            }
        }
    });

    function sendFile(file, peer, receiverId) {
        const chunkSize = 128 * 1024;
        const totalChunks = Math.ceil(file.size / chunkSize);

        const peerData = peers.get(receiverId);
        if (peerData) {
            peerData.chunkIndex = 0;
            peerData.totalChunks = totalChunks;
        }

        function sendNextChunk() {
            // Ensure the receiver exists in the peers map
            if (!peers.has(receiverId)) return;

            const peerData = peers.get(receiverId);
            if (!peerData) return;

            // Calculate the start and end byte positions for the current chunk
            const start = peerData.chunkIndex * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = file.slice(start, end); // Slice the file into the current chunk

            console.log(`🚀 ~ sendNextChunk ~ Sending chunk from ${start} to ${end}`);

            const fileReader = new FileReader();

            // This callback is triggered once the chunk is read as ArrayBuffer
            fileReader.onload = (e) => {
                if (!peers.has(receiverId)) return; // Check if receiver is still in the peers map

                const chunkArrayBuffer = e.target.result; // Get the ArrayBuffer of the chunk
                console.log(`🚀 ~ sendNextChunk ~ Loaded chunk:`, chunkArrayBuffer);

                const uint8Array = new Uint8Array(chunkArrayBuffer); // Convert ArrayBuffer to Uint8Array for transfer

                // Create a message containing the chunk data
                const message = JSON.stringify({
                    type: 'chunk',
                    data: {
                        index: peerData.chunkIndex, // Current chunk index
                        total: peerData.totalChunks, // Total number of chunks
                        chunk: Array.from(uint8Array), // Convert Uint8Array to array for transfer
                    },
                });

                // Send the chunk message to the peer
                peerData.peer.send(message);

                // Increment the chunkIndex for the next chunk
                peerData.chunkIndex++;

                // If there are more chunks, continue sending the next one
                if (peerData.chunkIndex < peerData.totalChunks) {
                    setTimeout(sendNextChunk, 15); // Use setTimeout to allow asynchronous sending
                } else {
                    // If all chunks are sent, signal completion
                    peerData.peer.send(JSON.stringify({ type: 'complete' }));
                    connectionStatus.textContent = `File transfer complete for receiver ${receiverId.substring(
                        0,
                        6
                    )}...`;
                }
            };

            // Read the chunk as an ArrayBuffer
            fileReader.readAsArrayBuffer(chunk);
        }

        // Call the sendNextChunk function to start the transfer
        sendNextChunk();
    }

    // Update overall progress
    function updateOverallProgress() {
        let totalProgress = 0;
        peers.forEach((data) => {
            totalProgress += data.progress || 0;
        });

        const averageProgress = peers.size > 0 ? Math.round(totalProgress / peers.size) : 0;
        progressBar.style.width = `${averageProgress}%`;
        progressText.textContent = `${averageProgress}% (${peers.size} active transfer${peers.size !== 1 ? 's' : ''})`;
    }

    // Clean up peer connection
    function cleanupPeer(receiverId) {
        const peerData = peers.get(receiverId);
        if (peerData && peerData.peer) {
            peerData.peer.destroy();
            peers.delete(receiverId);
            activeTransfers--;

            if (activeTransfers === 0) {
                connectionStatus.textContent = 'All transfers complete. Waiting for new receivers...';
            } else {
                updateOverallProgress();
            }
        }
    }

    socket.on('receiver-disconnected', ({ receiverId, totalReceivers }) => {
        connectionStatus.textContent = `Receiver ${receiverId.substring(
            0,
            6
        )}... disconnected. ${totalReceivers} receiver(s) still connected.`;
        cleanupPeer(receiverId);
    });

    socket.on('share-expired', () => {
        connectionStatus.textContent = 'Share has expired';
        // Clean up all peers
        peers.forEach((data, id) => {
            cleanupPeer(id);
        });
    });

    // Debug socket connection
    socket.on('connect', () => {
        console.log('Connected to server with ID:', socket.id);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });
});
