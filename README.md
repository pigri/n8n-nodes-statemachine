# n8n-nodes-statemachine

![n8n.io - Workflow Automation](https://raw.githubusercontent.com/n8n-io/n8n/master/assets/n8n-logo.png)

[n8n](https://www.n8n.io) "simple" state machine is storing your nodes/workflow state globally or workflow level

## What is the state machine?
A state machine refers to a programming concept where an application or workflow is divided into a series of states or steps, and the program progresses from one state to the next based on certain conditions or triggers.

## How to install

### Community Nodes (Recommended)

1. Go to **Settings > Community Nodes**.
2. Select **Install**.
3. Enter `n8n-nodes-statemachine` in **Enter npm package name**.
4. Agree to the [risks](https://docs.n8n.io/integrations/community-nodes/risks/) of using community nodes: select **I understand the risks of installing unverified code from a public source**.
5. Select **Install**.

After installing the node, you can use it like any other node. n8n displays the node in search results in the **Nodes** panel.

### Manual installation

To get started install the package in your n8n root directory:

`npm install n8n-nodes-statemachine`

For Docker-based deployments, add the following line before the font installation command in your [n8n Dockerfile](https://github.com/n8n-io/n8n/blob/master/docker/images/n8n/Dockerfile):

`RUN cd /usr/local/lib/node_modules/n8n && npm install n8n-nodes-statemachine`

### How to use

- This node has one external depedency is you need a redis service. You can find a free redis service [here](https://redis.com/redis-enterprise-cloud/pricing/)
- My suggestion is 1 trigger 1 state machine
- Always use error handler node in your workflow

## Demo

### Working well
- ![1st run](https://raw.githubusercontent.com/pigri/n8n-nodes-statemachine/master/assets/1st_run.png)
- ![2nd run](https://raw.githubusercontent.com/pigri/n8n-nodes-statemachine/master/assets/2nd_run.png)

### Error handling
- ![error](https://raw.githubusercontent.com/pigri/n8n-nodes-statemachine/master/assets/error.png)
- ![error_handling](https://raw.githubusercontent.com/pigri/n8n-nodes-statemachine/master/assets/error_handling.png)


## Errors
If you have any error, please open an issue on [Github](https://github.com/pigri/n8n-nodes-statemachine)



