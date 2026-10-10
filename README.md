# MiniBee Web

Página estática, somente para leitura da telemetria Bluetooth do FlyController. Abra por HTTPS em um navegador com Web Bluetooth; no iPhone, use Bluefy.

## Uso

Clique em **Conectar por Bluetooth**, selecione o FlyController e aguarde os valores nos quadrados. Não é necessário digitar PIN nesta página. O cliente não autentica, não altera configurações e não envia comandos ao motor.

O cartão **Temperatura motor (NTC)** apresenta somente uma leitura recebida com origem NTC. A temperatura do ESC é um campo separado e continua sendo exibida. Se a placa enviar a temperatura do motor pelo CAN, a página informa que a leitura NTC não chegou e deixa o cartão do motor sem valor. O navegador não mede o sensor físico nem escolhe a fonte que o firmware transmite.

Zero pode ser uma leitura válida; ausência ou invalidade aparece como travessão. Quando o firmware oferece a telemetria binária, a página também verifica a validade do sensor e mostra a suspensão da proteção térmica. Dados antigos são limpos ao desconectar ou expirar.

## Protocolos

- NUS: serviço `6e400001-b5a3-f393-e0a9-e50e24dcca9e`; TX `6e400003-b5a3-f393-e0a9-e50e24dcca9e`; `$XCTOD` com 16 campos e fim de linha.
- Fly Control v1, opcional: serviço `d4cf0001-9b9d-4bfd-8f7f-40c6989d3ea9`, somente notificações TELEMETRY. Não acessa CMD/RSP, AUTH ou CFG_SET.
- No XCTOD, a temperatura do motor ocupa o campo 8, sua origem o campo 9, e a temperatura do ESC o campo 12. No pacote binário, a origem é 1 CAN ou 2 NTC e a temperatura é transmitida em miligraus Celsius.

Contrato conferido no [FlyController, commit 342d8e0](https://github.com/rodrigomedeirosbrazil/fly-controller/blob/342d8e0c34514014862861c82f51476ef64a57de/src/BleControl/ControlProtocol.h).

## Verificação

Sem dependências ou etapa de build. Testes com DOM e Bluetooth simulados:

```sh
node --test test/telemetry.test.cjs
```

Os testes verificam ausência de escritas, valores NTC/CAN, mensagens fragmentadas, validade binária, expiração e reconexão. A conexão física com a placa e o navegador devem ser verificados no aparelho.
