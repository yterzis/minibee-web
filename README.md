# MiniBee Web

Página estática para telemetria Bluetooth do FlyController. Abra `index.html` por HTTPS em um navegador com Web Bluetooth; no iPhone, use Bluefy.

## Temperatura do motor pelo NTC externo

1. Conecte por Bluetooth e aguarde telemetria recente com o motor **desarmado**.
2. Se a fonte configurada for CAN, digite o PIN de configuração da placa e pressione **Usar NTC externo**.
3. Aguarde a confirmação da configuração e confira **Origem recebida: NTC externo** com uma leitura válida.

A seleção é salva pelo firmware. O cliente lê o grupo térmico atual, preserva os quatro limites de temperatura, altera somente `motorTempSource` para `1` e consulta novamente para confirmar. Não muda parâmetros do ESC nem envia comandos de aceleração. O PIN não é salvo no navegador; nenhuma configuração é escrita automaticamente ao conectar.

O cartão do motor exibe somente valores cuja origem é NTC. Uma leitura CAN permanece na mensagem bruta e gera uma orientação para selecionar NTC, sem ser apresentada como temperatura NTC. Zero pode ser uma leitura válida; ausência/invalidade do sensor aparece como travessão. Quando disponível, a telemetria binária confirma validade, origem e suspensão da proteção térmica.

Firmware sem serviço Fly Control compatível continua recebendo `$XCTOD`, mas não pode trocar a fonte por esta página. Nesse caso selecione NTC no aplicativo do FlyController ou no portal Wi-Fi, se a versão instalada oferecer esse recurso. A página não instala firmware nem cria uma leitura ausente.

## Protocolos usados

- NUS: serviço `6e400001-b5a3-f393-e0a9-e50e24dcca9e`; TX `6e400003-b5a3-f393-e0a9-e50e24dcca9e`; `$XCTOD` com 16 campos e fim de linha.
- Fly Control v1: serviço `d4cf0001-9b9d-4bfd-8f7f-40c6989d3ea9`; INFO, TELEMETRY, CMD e RSP. Requer a capability `MotorTempSourceSel`.
- Configuração: `AUTH` (`0x01`), `CFG_GET` (`0x10`), `CFG_SET` (`0x11`); grupo térmico `1`, 17 bytes, fonte no offset 16. Temperaturas binárias são miligraus Celsius.

Contrato conferido no [FlyController, commit 342d8e0](https://github.com/rodrigomedeirosbrazil/fly-controller/blob/342d8e0c34514014862861c82f51476ef64a57de/src/BleControl/ControlProtocol.h) e na implementação `BleControl.cpp` do mesmo commit.

## Verificação

Sem dependências ou etapa de build. Para executar os testes de recepção e configuração com Bluetooth simulado:

```sh
node --test test/telemetry.test.cjs
```

Esses testes não substituem a verificação da conexão BLE, do navegador e da leitura do sensor na placa física.
