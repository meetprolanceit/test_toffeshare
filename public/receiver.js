// public/receiver.js - UPDATED VERSION
document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const shareId = window.location.pathname.split('/').pop();
    const connectionStatus = document.getElementById('connectionStatus');
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName').querySelector('span');
    const fileSize = document.getElementById('fileSize').querySelector('span');
    const downloadBtn = document.getElementById('downloadBtn');
    const transferStatus = document.getElementById('transferStatus');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    let peer = null;
    let fileMetadata = null;
    let receivedChunks = [];
    let bytesReceived = 0;
    let senderId = null;
    let downloadRequested = false;

    console.log('Joining share with ID:', shareId);

    // Join the share room
    socket.emit('join-share', shareId, (response) => {
        console.log('Join share response:', response);

        if (!response.success) {
            connectionStatus.textContent = response.message;
            return;
        }

        connectionStatus.textContent = 'Connected to share. Waiting for file information...';

        // If we already have file metadata from the server, display it
        if (response.fileMetadata) {
            handleInitialMetadata(response.fileMetadata);
        }
    });

    // Handle file metadata received from server
    socket.on('file-metadata', (metadata) => {
        handleInitialMetadata(metadata);
    });

    // Handle initial metadata (before downloading)
    function handleInitialMetadata(metadata) {
        console.log('Received file metadata:', metadata);
        fileMetadata = metadata;
        fileName.textContent = metadata.name;
        fileSize.textContent = formatFileSize(metadata.size);
        fileInfo.classList.remove('hidden');

        // Enable download button
        downloadBtn.disabled = false;

        // When user clicks download, request the file
        downloadBtn.addEventListener('click', () => {
            if (!downloadRequested) {
                downloadRequested = true;
                connectionStatus.textContent = 'Requesting file download...';
                socket.emit('request-download', { shareId });
                downloadBtn.disabled = true;
            }
        });
    }

    // Handle incoming signals from sender
    socket.on('signal', ({ from, signal }) => {
        console.log('Received signal from:', from);
        senderId = from;

        if (!peer) {
            // Create peer connection (not initiator)
            console.log('Creating new peer connection');
            peer = new SimplePeer({
                initiator: false,
                trickle: false,
            });

            // Handle peer signals
            peer.on('signal', (data) => {
                console.log('Sending signal back to sender');
                socket.emit('signal', {
                    to: senderId,
                    signal: data,
                });
            });

            // Handle peer connect
            peer.on('connect', () => {
                console.log('Peer connection established');
                connectionStatus.textContent = 'Peer connection established! Receiving file...';
                // transferStatus.classList.remove('hidden');
            });

            // Handle data from peer
            peer.on('data', (data) => {
                const message = JSON.parse(new TextDecoder().decode(data));

                switch (message.type) {
                    case 'metadata':
                        handleTransferMetadata(message.data);
                        break;
                    case 'chunk':
                        handleChunk(message.data);
                        break;
                    case 'complete':
                        handleComplete();
                        break;
                }
            });

            peer.on('error', (err) => {
                console.error('Peer error:', err);
                connectionStatus.textContent = 'Connection error: ' + err.message;
            });
        }

        try {
            peer.signal(signal);
        } catch (err) {
            console.error('Error signaling peer:', err);
        }
    });

    // Handle file metadata at transfer time
    function handleTransferMetadata(metadata) {
        console.log('Received transfer metadata:', metadata);
        fileMetadata = metadata;
        receivedChunks = new Array(Math.ceil(metadata.size / (16 * 1024)));
        connectionStatus.textContent = 'Receiving file...';
    }

    // Handle file chunk
    function handleChunk(data) {
        console.log(`🚀 ~ handleChunk ~ data:`, data);

        // Convert array to Uint8Array
        const chunk = new Uint8Array(data.chunk);
        // const chunk = new Uint8Array(data.chunk);

        // Store chunk
        receivedChunks[data.index] = chunk;
        console.log(`🚀 ~ handleChunk ~ receivedChunks:`, receivedChunks);

        // Update progress
        bytesReceived += chunk.byteLength;
        peer.send(JSON.stringify({ type: 'ack', index: data.index }));

        const progress = Math.round((bytesReceived / fileMetadata.size) * 100);
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `${progress}%`;
    }

    // Handle file transfer complete
    function handleComplete() {
        console.log('File transfer complete');
        connectionStatus.textContent = 'File transfer complete!';

        // Create download link
        const blob = new Blob(
            receivedChunks.filter((chunk) => chunk),
            { type: fileMetadata.type }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileMetadata.name;
        document.body.appendChild(a);
        a.click();

        // Clean up
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 0);

        // Allow downloading again
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Download Again';
        downloadRequested = false;
    }

    // Format file size
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' bytes';
        else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        else return (bytes / 1073741824).toFixed(1) + ' GB';
    }

    socket.on('share-ended', ({ message }) => {
        connectionStatus.textContent = message || 'Share has ended';
        if (peer) {
            peer.destroy();
            peer = null;
        }
    });

    // Debug socket connection
    socket.on('connect', () => {
        console.log('Connected to server with ID:', socket.id);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });
});
