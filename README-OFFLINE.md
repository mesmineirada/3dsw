# Modela 3D — versão offline

Esta pasta contém o projeto completo e uma versão compilada que pode ser executada sem internet. A aplicação roda no navegador e não envia os modelos para nenhum servidor: os projetos salvos ficam no `localStorage` do navegador, e o STL é gerado localmente.

## Execução rápida, sem instalar dependências

É necessário ter **Node.js 18 ou superior** instalado. Não é necessário executar `npm install` ou `pnpm install` para abrir a versão compilada.

No Windows, dê duplo clique em `run-offline.bat`. No Linux ou macOS, abra um terminal nesta pasta e execute:

```bash
./run-offline.sh
```

Também é possível executar diretamente:

```bash
node offline-server.mjs
```

Depois, abra `http://127.0.0.1:4173` no navegador. Para encerrar, volte ao terminal e pressione `Ctrl+C`.

## O que está incluído

A pasta `dist/public` contém a versão pronta para execução offline. O restante do projeto contém o código-fonte React/Three.js, o `package.json`, o lockfile e a configuração usada para gerar a versão compilada. Para desenvolvimento futuro com o código-fonte, as dependências podem ser restauradas com `pnpm install` quando houver acesso à internet.

## Recursos de fixação

No painel **Fixação inteligente**, selecione individualmente **Conduto**, **Pino de trava** ou **Contra-trava**. Com **Autoancoragem** ativada, o componente fica vinculado à peça selecionada e acompanha seus movimentos. Com **Autoclique** ativado, clique diretamente em uma face da peça para criar o componente naquela face, orientado pela normal da superfície. O botão **Adicionar na peça selecionada** cria o componente no topo da peça-base.

O limite de trabalho é de 300 × 300 × 300 mm. Antes de exportar, corrija qualquer alerta indicado pelo Inspector.
