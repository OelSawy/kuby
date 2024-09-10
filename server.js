const k8s = require('@kubernetes/client-node');
const express = require('express');
const AWS = require('aws-sdk');
const path = require('path');
require('dotenv').config()
const app = express();
const port = process.env.PORT || 3000;
const namespace = process.env.NAMESPACE || "default";

// Initialize Kubernetes client configuration
const kc = new k8s.KubeConfig();

if (process.env.KUBERNETES_SERVICE_HOST) {
    // In-cluster configuration (used when running on EKS)
    kc.loadFromCluster();
} else {
    // Load local kubeconfig (used when running locally)
    kc.loadFromDefault();
}

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

// Configure AWS SDK with environment variables
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
    // Optional: you can also set the output format if needed
});

// Example of listing pods in the namespace "ra7tak-dev"
async function listPods(req, res) {
    try {
        const pods = await k8sApi.listNamespacedPod(namespace);

        // Map the pod information
        const podList = pods.body.items.map(pod => ({
            name: pod.metadata.name,
            status: pod.status.phase,
            age: calculateAge(pod.metadata.creationTimestamp),
            containers: pod.spec.containers.map(container => ({
                name: container.name,
                image: container.image,
            })),
        }));

        res.json(podList);
    } catch (error) {
        console.error('Error fetching pods:', error);
        res.status(500).json({ error: 'Failed to fetch pods' });
    }
}

// Calculate the age of the pod
function calculateAge(creationTimestamp) {
    const now = new Date();
    const createdAt = new Date(creationTimestamp);
    const ageInSeconds = Math.floor((now - createdAt) / 1000);
    const minutes = Math.floor(ageInSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    return days > 0 ? `${days}d ${hours % 24}h` : `${hours}h ${minutes % 60}m`;
}

app.use(express.static(path.join(__dirname, 'public')));
// Define routes
app.get('/pods', listPods);
app.get('/pods/:podName/logs', async (req, res) => {
    try {
        const { podName } = req.params;
        const logs = await k8sApi.readNamespacedPodLog(podName, namespace);
        res.send(logs.body);
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
