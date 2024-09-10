import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import {EquinixCluster} from "./cluster";


const certManager = new k8s.helm.v3.Release("cert-manager", {
    chart: "cert-manager",
    version: "v1.15.3",
    namespace: "cert-manager",
    createNamespace: true,
    repositoryOpts: {
        repo: "https://charts.jetstack.io",
    },
    values: {
        installCRDs: true,
    },
});

const k8sProvider = new k8s.Provider("k8s", {
    enableServerSideApply: true,
})

const capi = new k8s.yaml.ConfigFile("capi", {
    file: "./manifests/capi.yaml",
}, {dependsOn: certManager, ignoreChanges: ["*"], provider: k8sProvider});


const capemNamespace = new k8s.core.v1.Namespace("capem", {
    metadata: {
        name: "cluster-api-provider-packet-system",
        labels: {
            "cluster.x-k8s.io/provider": "infrastructure-packet",
            "control-plane": "controller-manager"
        }
    },
}, {
    dependsOn: [
        certManager,
        capi,
    ],
});

const config = new pulumi.Config();

const originalSecret = new k8s.core.v1.Secret("api-credentials", {
        metadata: {
            name: "cluster-api-provider-packet-manager-api-credentials",
            namespace: capemNamespace.metadata.name,
        },
        type: "Opaque",
        stringData: {
            "PACKET_API_KEY": config.require("metal-api-key"),
        }
    },
    {
        dependsOn: [
            certManager,
            capi,
        ],
    }
);

const capem = new k8s.yaml.ConfigFile("capem", {
    file: "./manifests/capem.yaml",
}, {
    dependsOn: [
        certManager,
        capi,
        capemNamespace,
        originalSecret,
    ],
});


for (let i = 0; i < 0; i++) {
    const equinixCluster = new EquinixCluster("equinixCluster" + i, {
        name: "equinix-cluster-" + i,
        sshKey: config.get("sshKey") || "",
        projectID: config.require("projectID"),
        metro: "FR",
        os: "ubuntu_20_04",
        machineType: "m3.small.x86",
        namespace: "default",
        kubernetesVersion: "v1.31.0"
    }, {
        dependsOn: [
            certManager,
            capi,
            capem,
        ],
    });
}

