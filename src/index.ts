import { WebSocketServer } from "ws";
import { createClient } from "redis";
import dotenv from "dotenv";
import { createServer } from "http";
import { JwtPayload, verify } from "jsonwebtoken";
import z from "zod";
import { parseCookies } from "./lib/cookieParser";
import { db } from "./lib/db";
const pubClient = createClient();
const subClient = createClient();
const redisDb = createClient({
  url: "redis://localhost:6380",
});
pubClient.on("error", (err) => console.log("Redis Client Error", err));
subClient.on("error", (err) => console.log("Redis Client Error", err));
dotenv.config();
const msgSchema = z.object({
  to: z.string(),
  msg: z.string(),
  conversationId: z.string(),
});
type Socket = {
  id: string;
  username: string;
} & WebSocket;
const socketsConnected = new Map<string, Socket>();
const server = createServer();
server.on("upgrade", async (req, socket, head) => {
  if (req.headers.origin !== "http://localhost:3000") socket.end();
  const cookies = parseCookies(req);

  const token = cookies.token;
  if (!token) socket.end();
  else {
    try {
      await verify(token, process.env.JWT_SECRET as string);
    } catch (error) {
      socket.end();
    }
  }
});

const wss = new WebSocketServer({ server, clientTracking: false });

wss.on("connection", async (socket: Socket, req) => {
  const cookies = parseCookies(req);
  const token = cookies.token;
  const p = (await verify(
    token,
    process.env.JWT_SECRET as string
  )) as JwtPayload;
  socket.id = p.id as string;
  socket.username = p.username as string;
  socketsConnected.set(socket.id, socket);

  socket.onclose = (ev) => {
    socketsConnected.delete(socket.id);
  };
  socket.onmessage = async (e) => {
    try {
      const { msg, to, conversationId } = msgSchema.parse(JSON.parse(e.data));
      const isValidMsg = await redisDb.smIsMember(
        `conversations:${conversationId}`,
        [to, socket.id]
      );
      if (!(isValidMsg[0] && isValidMsg[0])) return;
      if (socketsConnected.has(to)) {
        socketsConnected
          .get(to)
          ?.send(JSON.stringify({ msg, from: socket.id, conversationId }));
      } else
        pubClient.publish(
          "message",
          JSON.stringify({ msg, to, from: socket.id, conversationId })
        );
      await db.message.create({
        data: {
          content: msg,
          senderId: socket.id,
          conversationId: conversationId,
        },
      });
    } catch (error) {
      console.log(error);
    }
  };
});

async function main(port: number) {
  await subClient.connect();
  subClient.subscribe("message", async (data) => {
    try {
      const { msg, to, from, conversationId } = JSON.parse(data) as {
        msg: string;
        to: string;
        from: string;
        conversationId: string;
      };

      socketsConnected
        .get(to)
        ?.send(JSON.stringify({ msg, from, conversationId }));
    } catch (error) {
      console.log(error);
    }
  });
  await pubClient.connect();
  await redisDb.connect();
  console.log("seeding the redis");
  const converations = await db.conversation.findMany({
    select: {
      id: true,
      userIds: true,
    },
  });
  converations.forEach(async (convo) => {
    const keyExists = await redisDb.exists(`conversations:${convo.id}`);
    if (!keyExists)
      await redisDb.SADD(`conversations:${convo.id}`, convo.userIds);
  });
  server.listen(port, () => {
    console.log(`server up on ${port}`);
  });
}

main(8081);
