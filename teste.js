const net = require('net');

const serverIP = '127.0.0.1';
const serverPort = 25565;
const username = 'BotTesteKK';

const ConnectionState = {
  HANDSHAKING: 0,
  LOGIN: 2,
  PLAY: 3
};

let connectionState = ConnectionState.HANDSHAKING;

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
    sendKeepAliveResponse(buffer);
  }
}

function sendKeepAliveResponse(buffer) {
  client.write(buffer);
  console.log(`sent keep-alive: ${buffer.toString('hex')}`);
}

function createPacket(packetId, data) {
  const packetLength = createVarInt(data.length + 1);
  const idBuffer = Buffer.from([packetId]);
  return Buffer.concat([packetLength, idBuffer, data]);
}

function handshakePacket() {
  const protocolVersion = createVarInt(47);
  const serverAddress = Buffer.concat([Buffer.from([serverIP.length]), Buffer.from(serverIP)]);
  const serverPort = Buffer.from([0x63, 0xdd]);
  const nextState = createVarInt(2);
  connectionState = ConnectionState.LOGIN;
  return createPacket(0x00, Buffer.concat([protocolVersion, serverAddress, serverPort, nextState]));
}

function loginStartPacket() {
  const nameLength = createVarInt(username.length);
  const usernameBuffer = Buffer.from(username, 'utf-8');
  return createPacket(0x00, Buffer.concat([nameLength, usernameBuffer]));
}

const client = new net.Socket();
client.connect(serverPort, serverIP, () => {
  console.log('Bot connected!');
  client.write(handshakePacket());
  client.write(loginStartPacket());
});

client.on('data', (data) => {
  displayPacket(data);
});

client.on('error', (err) => {
  console.error('shitty error:', err);
});

client.on('close', () => {
  console.log('wtf happened to the bot.');
});
