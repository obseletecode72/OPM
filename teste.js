const axios = require('axios');  // Usando axios para requisição HTTP
const readline = require('readline');
const chalk = require('chalk');
const fs = require('fs');
const { SocksClient } = require('socks');

let verboseMode = false;
let proxies = [];

// URL onde as proxies SOCKS4 estão armazenadas (pode ser atualizada com o link direto para o raw file)
const proxyURL = 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt';

// Carregar proxies automaticamente da URL
async function loadProxiesFromURL() {
  try {
    const response = await axios.get(proxyURL);
    const data = response.data;
    proxies = data.split('\n').map(line => line.trim()).filter(line => line);
    console.log(`Carregado ${proxies.length} proxies da URL.`);
  } catch (error) {
    console.error('Erro ao carregar proxies da URL:', error.message);
  }
}

// Escolher uma proxy aleatória
function getRandomProxy() {
  if (proxies.length === 0) {
    return null;
  }
  const proxy = proxies[Math.floor(Math.random() * proxies.length)];
  const [ip, port] = proxy.split(':');
  return { ip, port: parseInt(port, 10) };
}

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

function pingServerWithProxy(serverIP, serverPort, proxy, callback) {
  const options = {
    proxy: {
      ipaddress: proxy.ip,
      port: proxy.port,
      type: 4,  // Tipo SOCKS4
    },
    command: 'connect',
    destination: {
      host: serverIP,
      port: serverPort,
    },
  };

  SocksClient.createConnection(options).then(({ socket }) => {
    log('Conectado via proxy SOCKS4 para pingar o servidor...', false);

    socket.write(handshakePacket(serverIP, serverPort, ConnectionState.STATUS));
    socket.write(statusRequestPacket());

    socket.on('data', (data) => {
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

        socket.write(pingPacket());
      }

      if (packetId === 0x01) {
        log('Servidor pingado com sucesso.', false);
        socket.end();
        callback();
      }
    });

    socket.on('error', (err) => {
      console.error('Erro durante o ping:', err);
      socket.end();
    });

    socket.on('close', () => {
      log('Conexão para o ping fechada.', false);
    });
  }).catch((err) => {
    console.error('Erro ao conectar via proxy SOCKS4:', err);
  });
}

function connectBotWithProxy(serverIP, serverPort, username, proxy) {
  pingServerWithProxy(serverIP, serverPort, proxy, () => {
    const options = {
      proxy: {
        ipaddress: proxy.ip,
        port: proxy.port,
        type: 4,  // Tipo SOCKS4
      },
      command: 'connect',
      destination: {
        host: serverIP,
        port: serverPort,
      },
    };

    SocksClient.createConnection(options).then(({ socket }) => {
      let connectionState = ConnectionState.HANDSHAKING;

      log(`Bot ${username} connected via proxy!`, true);
      socket.write(handshakePacket(serverIP, serverPort, ConnectionState.LOGIN));
      socket.write(loginStartPacket(username));
      connectionState = ConnectionState.LOGIN;

      socket.on('data', (data) => {
        // Trate os pacotes recebidos aqui
      });

      socket.on('error', (err) => {
        console.error(`Error for bot ${username}:`, err);
      });

      socket.on('close', () => {
        log(`Connection closed for bot ${username}`, true);
      });
    }).catch((err) => {
      console.error(`Erro ao conectar bot ${username} via proxy:`, err);
    });
  });
}

function generateRandomBotName() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const length = Math.floor(Math.random() * 3) + 5;
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
    loadProxiesFromURL();  // Carregar as proxies da URL antes de iniciar
    if (debugMode.toLowerCase() === 's') {
      log('Entrando em modo debug...', true);
      const proxy = getRandomProxy();
      if (proxy) {
        connectBotWithProxy('127.0.0.1', 25565, 'BotDebug', proxy);
      } else {
        console.log('Nenhuma proxy disponível.');
      }
    } else {
      rl.question('Digite o IP do servidor: ', (serverIP) => {
        rl.question('Digite a porta do servidor: ', (serverPort) => {
          rl.question('Digite o número de bots para conectar: ', (botNumber) => {
            let botCount = 0;

            const interval = setInterval(() => {
              if (botCount >= botNumber) {
                clearInterval(interval);
                rl.close();
              } else {
                const proxy = getRandomProxy();
                if (proxy) {
                  const botName = generateRandomBotName();
                  connectBotWithProxy(serverIP, parseInt(serverPort), botName, proxy);
                  botCount++;
                }
              }
            }, 1000);
          });
        });
      });
    }
  });
});
