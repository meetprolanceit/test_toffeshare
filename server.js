// server.js - UPDATED VERSION
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store active file share sessions
const activeSessions = {};

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle file share initiation
    socket.on('create-share', (callback) => {
        // Generate a real UUID for the share ID
        const shareId = '123';
        activeSessions[shareId] = {
            creatorId: socket.id,
            receivers: [],
            fileMetadata: null,
            created: Date.now(),
        };
        socket.join(shareId);
        console.log(`User ${socket.id} created share: ${shareId}`);
        callback(shareId);
    });

    // Handle receiver joining a share
    socket.on('join-share', (shareId, callback) => {
        console.log(`User ${socket.id} attempting to join share: ${shareId}`);
        const session = activeSessions[shareId];

        if (!session) {
            console.log(`Share ${shareId} not found or expired`);
            callback({ success: false, message: 'Share not found or expired' });
            return;
        }

        // Add this receiver to the session's receivers list
        if (!session.receivers.includes(socket.id)) {
            session.receivers.push(socket.id);
        }
        socket.join(shareId);

        console.log(`Notifying creator ${session.creatorId} that receiver ${socket.id} has joined`);

        // Notify creator that receiver has joined
        io.to(session.creatorId).emit('receiver-joined', {
            receiverId: socket.id,
            totalReceivers: session.receivers.length,
        });

        callback({
            success: true,
            fileMetadata: session.fileMetadata, // Send file metadata if available
        });
    });

    // Save file metadata from sender
    socket.on('file-metadata', ({ shareId, metadata }) => {
        const session = activeSessions[shareId];
        if (session && session.creatorId === socket.id) {
            session.fileMetadata = metadata;
            // Notify all receivers about the file metadata
            socket.to(shareId).emit('file-metadata', metadata);
        }
    });

    // Handle receiver requesting to download
    socket.on('request-download', ({ shareId }) => {
        const session = activeSessions[shareId];
        if (session) {
            // Notify sender that this receiver wants to download
            io.to(session.creatorId).emit('download-requested', {
                receiverId: socket.id,
            });
        }
    });

    // WebRTC signaling
    socket.on('signal', ({ to, signal }) => {
        console.log(`Relaying signal from ${socket.id} to ${to}`);
        io.to(to).emit('signal', {
            from: socket.id,
            signal,
        });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Remove any sessions this user created
        for (const [shareId, session] of Object.entries(activeSessions)) {
            console.log(`🚀 ~ socket.on ~ [shareId, session]:`, [shareId, session]);

            if (session.creatorId === socket.id) {
                console.log(`Creator ${socket.id} disconnected, ending share ${shareId}`);
                io.to(shareId).emit('share-ended', { message: 'File sender disconnected' });
                delete activeSessions[shareId]; // Remove the session
            }

            // If receiver disconnects, notify creator
            const receiverIndex = session.receivers.indexOf(socket.id);
            if (receiverIndex !== -1) {
                console.log(`Receiver ${socket.id} disconnected from share ${shareId}`);
                session.receivers.splice(receiverIndex, 1); // Remove the receiver
                io.to(session.creatorId).emit('receiver-disconnected', {
                    receiverId: socket.id,
                    totalReceivers: session.receivers.length,
                });
            }
        }
    });
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/share/:id', (req, res) => {
    const shareId = req.params.id;
    console.log(`Serving receive page for share ID: ${shareId}`);
    res.sendFile(path.join(__dirname, 'public', 'receive.html'));
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
