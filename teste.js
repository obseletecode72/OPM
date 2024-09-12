const net = require('net');
const readline = require('readline');

const ConnectionState = {
  HANDSHAKING: 0,
  LOGIN: 2,
  PLAY: 3
};

function readVarInt(buffer, offset = 0) {
  let numRead = 0;
  let result = 0;
  let read;
  do {
    read = buffer.readUInt8(offset + numRead);
    result |= (read & 0x7F) << (7 * numRead);
    numRead++;
    if (numRead > 5) {
      throw new Error('VarInt is too big');
    }
  } while ((read & 0x80) !== 0);
  return { value: result, size: numRead };
}

function createVarInt(value) {
  const buffer = [];
  while (true) {
    if ((value & ~0x7F) === 0) {
      buffer.push(value);
      return Buffer.from(buffer);
    }
    buffer.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
}

function displayPacket(buffer) {
  let offset = 0;
  const { value: packetLength, size: lengthSize } = readVarInt(buffer, offset);
  offset += lengthSize;
  const { value: packetId, size: idSize } = readVarInt(buffer, offset);
  offset += idSize;
  const packetData = buffer.slice(offset);
  if (packetLength === 6 && packetId === 0x00 && packetData[0] === 0x00) {
    console.log(`keep-alive detected. sending back.`);
    return buffer;
  }
  return null;
}

function createPacket(packetId, data) {
  const packetLength = createVarInt(data.length + 1);
  const idBuffer = Buffer.from([packetId]);
  return Buffer.concat([packetLength, idBuffer, data]);
}

function handshakePacket(serverIP, serverPort) {
  const protocolVersion = createVarInt(47);
  const serverAddress = Buffer.concat([Buffer.from([serverIP.length]), Buffer.from(serverIP)]);
  const portBuffer = Buffer.alloc(2);
  portBuffer.writeUInt16BE(serverPort);
  const nextState = createVarInt(2);
  return createPacket(0x00, Buffer.concat([protocolVersion, serverAddress, portBuffer, nextState]));
}

function loginStartPacket(username) {
  const nameLength = createVarInt(username.length);
  const usernameBuffer = Buffer.from(username, 'utf-8');
  return createPacket(0x00, Buffer.concat([nameLength, usernameBuffer]));
}

function connectBot(serverIP, serverPort, username) {
  const client = new net.Socket();
  let connectionState = ConnectionState.HANDSHAKING;

  client.connect(serverPort, serverIP, () => {
    console.log(`Bot ${username} connected!`);
    client.write(handshakePacket(serverIP, serverPort));
    client.write(loginStartPacket(username));
    connectionState = ConnectionState.LOGIN;
  });

  client.on('data', (data) => {
    const response = displayPacket(data);
    if (response) {
      client.write(response);
    }
  });

  client.on('error', (err) => {
    console.error(`Error for bot ${username}:`, err);
  });

  client.on('close', () => {
    console.log(`Connection closed for bot ${username}`);
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Digite o IP do servidor: ', (serverIP) => {
  rl.question('Digite a porta do servidor: ', (serverPort) => {
    rl.question('Digite o número de bots para conectar por segundo: ', (botsPerSecond) => {
      rl.close();

      const connectRate = parseInt(botsPerSecond);
      let botCount = 0;

      console.log(`Conectando ${connectRate} bots por segundo a ${serverIP}:${serverPort} indefinidamente.`);

      setInterval(() => {
        for (let i = 0; i < connectRate; i++) {
          botCount++;
          connectBot(serverIP, parseInt(serverPort), `Bot${botCount}`);
        }
        console.log(`Total de bots conectados: ${botCount}`);
      }, 1000);
    });
  });
});
