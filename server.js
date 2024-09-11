const k8s = require('@kubernetes/client-node');
const express = require('express');
const AWS = require('aws-sdk');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session'); // Add this
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const defaultNamespace = process.env.NAMESPACE1 || "default";
const namespaces = [process.env.NAMESPACE1, process.env.NAMESPACE2]; // ra7tak and ra7tak-dev

// Middleware to parse request body
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Add session handling middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key', // Store secret in env variable
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Simple authentication middleware
app.use((req, res, next) => {
    if (req.path !== '/login' && req.path !== '/auth' && !req.session?.authenticated) {
        return res.redirect('/login');
    }
    next();
});

// Initialize Kubernetes client configuration
const kc = new k8s.KubeConfig();
if (process.env.KUBERNETES_SERVICE_HOST) {
    kc.loadFromCluster();
} else {
    kc.loadFromDefault();
}

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

// Configure AWS SDK with environment variables
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
});

// Serve the static HTML files
app.use(express.static(path.join(__dirname, 'public')));

// Login page route
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Authentication route
app.post('/auth', (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
        req.session.authenticated = true;
        res.redirect('/');
    } else {
        res.send('Invalid password');
    }
});

// Example of listing pods in the selected namespace
async function listPods(req, res) {
    const namespace = req.query.namespace || defaultNamespace; 
    try {
        const pods = await k8sApi.listNamespacedPod(namespace);
        const podList = pods.body.items.map(pod => ({
            name: pod.metadata.name,
            status: getPodStatus(pod), 
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

// Calculate the correct pod status
function getPodStatus(pod) {
    const containerStatuses = pod.status.containerStatuses || [];
    const containerStatus = containerStatuses.find(status => status.state.waiting || status.state.terminated) || {};
    if (containerStatus.state) {
        if (containerStatus.state.waiting) {
            return containerStatus.state.waiting.reason || 'Pending';
        } else if (containerStatus.state.terminated) {
            return containerStatus.state.terminated.reason || 'Terminated';
        }
    }
    return pod.status.phase;
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

// Fetch logs for a specific pod in a namespace
app.get('/pods/:podName/logs', async (req, res) => {
    const namespace = req.query.namespace || defaultNamespace;
    const { podName } = req.params;
    try {
        const logs = await k8sApi.readNamespacedPodLog(podName, namespace);
        res.send(logs.body);
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

// Define route to get pod data
app.get('/pods', listPods);

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
