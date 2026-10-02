import jwt from 'jsonwebtoken';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Group from '../models/Group.js';
import LiveSession from '../models/LiveSession.js';
import { sendWebPush } from '../utils/webpush.js';

export const initSocket = (io) => {
  // Map: userId -> Set of socketIds
  const userSockets = new Map();

  // Helper: get socket ids for a user
  const getUserSockets = (userId) => {
    return userSockets.get(userId.toString()) || new Set();
  };

  // Helper: emit to specific user
  const emitToUser = (userId, event, data) => {
    const sockets = getUserSockets(userId);
    sockets.forEach((socketId) => {
      io.to(socketId).emit(event, data);
    });
  };

  // Make emitToUser available globally on io
  io.emitToUser = emitToUser;

  // ─── Zombie Session Cleanup (every 5 minutes) ────────────────
  setInterval(async () => {
    try {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const zombies = await LiveSession.updateMany(
        {
          status: 'live',
          $or: [
            { lastHeartbeat: { $lt: fiveMinAgo } },
            { lastHeartbeat: { $exists: false }, startedAt: { $lt: fiveMinAgo } },
          ],
        },
        { status: 'ended', endedAt: new Date() }
      );
      if (zombies.modifiedCount > 0) {
        console.log(`🧹 Cleaned up ${zombies.modifiedCount} zombie live sessions`);
      }
    } catch (err) {
      console.error('Zombie cleanup error:', err.message);
    }
  }, 5 * 60 * 1000);

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // ─── Authentication (with JWT verification) ────────────────
    socket.on('authenticate', async (token) => {
      if (!token) return;

      let userId;
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.userId || decoded.id || decoded._id;
      } catch {
        socket.emit('auth-error', { message: 'Invalid or expired token' });
        return;
      }

      if (!userId) return;
      socket.userId = userId.toString();

      if (!userSockets.has(socket.userId)) {
        userSockets.set(socket.userId, new Set());
      }
      userSockets.get(socket.userId).add(socket.id);
      console.log(`👤 User ${socket.userId} authenticated (socket: ${socket.id})`);
    });

    // ─── Guard: ensure authenticated ──────────────────────────
    const requireAuth = () => {
      if (!socket.userId) {
        socket.emit('auth-error', { message: 'Not authenticated' });
        return false;
      }
      return true;
    };

    // ─── Group Rooms ──────────────────────────────────────────────
    socket.on('join-group-room', async ({ groupId }) => {
      if (!groupId) return;
      if (!requireAuth()) return;
      try {
        const group = await Group.findById(groupId).select('teacher students');
        const user = await User.findById(socket.userId).select('role');
        if (!group) return socket.emit('error', { message: 'المجموعة غير موجودة' });
        const isTeacher = group.teacher?.toString() === socket.userId;
        const isStudent = group.students.some(s => s.toString() === socket.userId);
        const isAdmin = user?.role === 'admin';
        if (!isTeacher && !isStudent && !isAdmin) {
          return socket.emit('error', { message: 'غير مصرح لك بالانضمام لغرفة هذه المجموعة' });
        }
        socket.join(`group:${groupId}`);
        const count = io.sockets.adapter.rooms.get(`group:${groupId}`)?.size || 0;
        socket.emit('room-joined', { groupId, onlineCount: count });
        console.log(`📚 Socket ${socket.id} joined group:${groupId}`);
      } catch (err) {
        console.error('join-group-room error:', err.message);
      }
    });

    socket.on('leave-group-room', ({ groupId }) => {
      socket.leave(`group:${groupId}`);
    });

    // ─── Live Broadcast (WebRTC Signaling) ────────────────────────
    // NOTE: broadcast-started is primarily emitted by the HTTP controller (startSession).
    // This socket handler exists as a fallback for direct socket-based starts.
    socket.on('start-broadcast', async ({ sessionId, groupId }) => {
      if (!requireAuth()) return;
      // Verify user is admin/teacher of the group
      try {
        const group = await Group.findById(groupId).select('teacher');
        const user = await User.findById(socket.userId).select('role');
        if (!group) return socket.emit('error', { message: 'Group not found' });
        const isTeacher = group.teacher?.toString() === socket.userId;
        const isAdmin = user?.role === 'admin';
        if (!isTeacher && !isAdmin) {
          return socket.emit('error', { message: 'Unauthorized to start broadcast' });
        }
      } catch {
        return socket.emit('error', { message: 'Authorization check failed' });
      }

      socket.broadcast.to(`group:${groupId}`).emit('broadcast-started', {
        sessionId,
        teacherSocketId: socket.id,
        teacherId: socket.userId,
      });
      console.log(`🔴 Broadcast started: session ${sessionId}`);
    });

    socket.on('end-broadcast', async ({ sessionId, groupId }) => {
      if (!requireAuth()) return;
      // Verify user is admin/teacher of the group
      try {
        const group = await Group.findById(groupId).select('teacher');
        const user = await User.findById(socket.userId).select('role');
        if (!group) return socket.emit('error', { message: 'Group not found' });
        const isTeacher = group.teacher?.toString() === socket.userId;
        const isAdmin = user?.role === 'admin';
        if (!isTeacher && !isAdmin) {
          return socket.emit('error', { message: 'Unauthorized to end broadcast' });
        }
      } catch {
        return socket.emit('error', { message: 'Authorization check failed' });
      }

      io.to(`group:${groupId}`).emit('broadcast-ended', { sessionId });
      console.log(`⬛ Broadcast ended: session ${sessionId}`);
    });

    // ─── Session Heartbeat ────────────────────────────────────────
    socket.on('session-heartbeat', async ({ sessionId }) => {
      if (!requireAuth()) return;
      try {
        await LiveSession.findByIdAndUpdate(sessionId, { lastHeartbeat: new Date() });
      } catch {}
    });

    // ─── Session Rooms (for individual 1-on-1 and direct sessions) ──
    socket.on('join-session-room', async ({ sessionId }) => {
      if (!sessionId) return;
      if (!requireAuth()) return;
      try {
        const session = await LiveSession.findById(sessionId).select('teacher student group');
        if (!session) return socket.emit('error', { message: 'الجلسة غير موجودة' });
        const user = await User.findById(socket.userId).select('role');
        const isTeacher = session.teacher?.toString() === socket.userId;
        const isStudent = session.student?.toString() === socket.userId;
        const isAdmin = user?.role === 'admin';
        if (!isTeacher && !isStudent && !isAdmin) {
          return socket.emit('error', { message: 'غير مصرح لك بدخول هذه الجلسة' });
        }
        socket.join(`session:${sessionId}`);
        socket.emit('session-room-joined', { sessionId });
      } catch (err) {
        console.error('join-session-room error:', err.message);
      }
    });

    socket.on('leave-session-room', ({ sessionId }) => {
      if (sessionId) socket.leave(`session:${sessionId}`);
    });

    // ─── Chat ─────────────────────────────────────────────────────
    const handleChatMessage = async ({ sessionId, groupId, message, type, senderName }) => {
      if (!requireAuth()) return;
      if (!message || (!groupId && !sessionId)) return;

      // Verify membership
      try {
        if (groupId) {
          const group = await Group.findById(groupId).select('teacher students');
          const user = await User.findById(socket.userId).select('role');
          if (!group) return;
          const isTeacher = group.teacher?.toString() === socket.userId;
          const isStudent = group.students.some(s => s.toString() === socket.userId);
          const isAdmin = user?.role === 'admin';
          if (!isTeacher && !isStudent && !isAdmin) return;
        } else if (sessionId) {
          const session = await LiveSession.findById(sessionId).select('teacher student group');
          if (!session) return;
          const user = await User.findById(socket.userId).select('role');
          const isTeacher = session.teacher?.toString() === socket.userId;
          const isStudent = session.student?.toString() === socket.userId;
          const isAdmin = user?.role === 'admin';
          if (!isTeacher && !isStudent && !isAdmin) return;
        }
      } catch {
        return;
      }

      // Sanitize message length
      const sanitizedMessage = String(message).substring(0, 2000);

      const chatMsg = {
        sender: socket.userId,
        senderId: socket.userId,
        senderName: senderName || 'مستخدم',
        message: sanitizedMessage,
        type: type || 'text',
        sentAt: new Date(),
        socketId: socket.id,
      };

      if (groupId) {
        io.to(`group:${groupId}`).emit('live-message', chatMsg);
      }
      if (sessionId) {
        io.to(`session:${sessionId}`).emit('live-message', chatMsg);
      }

      // Persist to DB (cap at 500 messages to prevent unbounded document growth)
      if (sessionId) {
        try {
          await LiveSession.findByIdAndUpdate(sessionId, {
            $push: { chatMessages: { $each: [{ sender: socket.userId, message: sanitizedMessage, type, sentAt: new Date() }], $slice: -500 } },
          });
        } catch (err) {
          console.error('Chat persist error:', err.message);
        }
      }
    };
    socket.on('send-live-message', handleChatMessage);
    socket.on('send-chat-message', handleChatMessage); // backward compat

    // ─── Hand Raise ───────────────────────────────────────────────
    socket.on('raise-hand', ({ sessionId, groupId, studentName }) => {
      if (!requireAuth()) return;
      socket.to(`group:${groupId}`).emit('hand-raised', {
        studentId: socket.userId,
        socketId: socket.id,
        studentName: studentName || 'طالب',
      });
    });

    socket.on('lower-hand', ({ sessionId, groupId }) => {
      if (!requireAuth()) return;
      socket.to(`group:${groupId}`).emit('hand-lowered', {
        studentId: socket.userId,
      });
    });

    // ─── Leave Session (update leftAt for attendance tracking) ─────
    socket.on('leave-session', async ({ sessionId, groupId }) => {
      if (!requireAuth()) return;
      if (!sessionId) return;
      try {
        const session = await LiveSession.findOneAndUpdate(
          {
            _id: sessionId,
            attendees: {
              $elemMatch: {
                student: socket.userId,
                $or: [{ leftAt: { $exists: false } }, { leftAt: null }],
              },
            },
          },
          {
            $set: { 'attendees.$.leftAt': new Date() },
          },
          { new: true }
        );
        const targetGroup = groupId || session?.group;
        if (targetGroup) {
          io.to(`group:${targetGroup}`).emit('student-left-session', {
            sessionId,
            studentId: socket.userId,
            leftAt: new Date(),
          });
        }
        console.log(`👋 Student ${socket.userId} left session ${sessionId}`);
      } catch (err) {
        console.error('leave-session error:', err.message);
      }
    });

    // ─── Progress ─────────────────────────────────────────────────
    socket.on('lesson-completed', ({ lessonId, groupId }) => {
      socket.to(`group:${groupId}`).emit('progress-updated', {
        studentId: socket.userId,
        lessonId,
      });
    });

    socket.on('memorization-update', ({ verses, juz, groupId }) => {
      socket.to(`group:${groupId}`).emit('progress-updated', {
        studentId: socket.userId,
        memorizedVerses: verses,
        currentJuz: juz,
      });
    });

    // ─── Disconnect ───────────────────────────────────────────────
    socket.on('disconnect', async () => {
      if (socket.userId) {
        // Mark leftAt for any live sessions this user was attending
        try {
          const sessions = await LiveSession.find({
            status: 'live',
            attendees: {
              $elemMatch: {
                student: socket.userId,
                $or: [{ leftAt: { $exists: false } }, { leftAt: null }],
              },
            },
          }).select('_id group');

          for (const s of sessions) {
            await LiveSession.updateOne(
              {
                _id: s._id,
                attendees: {
                  $elemMatch: {
                    student: socket.userId,
                    $or: [{ leftAt: { $exists: false } }, { leftAt: null }],
                  },
                },
              },
              {
                $set: { 'attendees.$.leftAt': new Date() },
              }
            );
            if (s.group) {
              io.to(`group:${s.group}`).emit('student-left-session', {
                sessionId: s._id,
                studentId: socket.userId,
                leftAt: new Date(),
              });
            }
          }
        } catch (err) {
          console.error('Disconnect attendance update error:', err.message);
        }

        const sockets = userSockets.get(socket.userId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) userSockets.delete(socket.userId);
        }
      }
      console.log(`🔥 Socket disconnected: ${socket.id}`);
    });
  });
};
