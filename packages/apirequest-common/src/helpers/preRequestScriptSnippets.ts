export default [
  {
    name: "workbench.snippets.environment",
    script: `\n\n// Set an environment variable
hopp.env.set("variable", "value");`,
  },
  {
    name: "workbench.snippets.timestamp",
    script: `\n\n// Set timestamp variable
const currentTime = Date.now();
hopp.env.set("timestamp", currentTime.toString());`,
  },
  {
    name: "workbench.snippets.random",
    script: `\n\n// Set random number variable
const min = 1
const max = 1000
const randomArbitrary = Math.random() * (max - min) + min
hopp.env.set("randomNumber", randomArbitrary.toString());`,
  },
]
