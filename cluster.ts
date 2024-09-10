import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface EquinixClusterArgs {
    name: string;
    namespace: string | "default";
    kubernetesVersion: string | "v1.31.0";
    projectID: string;
    metro: string | "FR";
    machineType: string | "m3.small.x86";
    sshKey: string;
    os: string | "ubuntu_20_04";
    numberOfControlPlaneNodes?: number | 1;
    numberOfWorkerNodes?: number | 1;
}

export class EquinixCluster extends pulumi.ComponentResource {
    readonly name: pulumi.Input<string>;

    constructor(name: string,
                args: EquinixClusterArgs,
                opts: pulumi.ComponentResourceOptions = {}) {
        super("pkg:index:EquinixCluster", name, {}, opts);

        // @ts-ignore
        const kubeadmConfigTemplate = new k8s.apiextensions.CustomResource(args.name+"-worker-a", {
            apiVersion: "bootstrap.cluster.x-k8s.io/v1beta1",
            kind: "KubeadmConfigTemplate",
            metadata: {
                name: args.name + "-worker-a",
                namespace: "default",
            },
            spec: {
                template: {
                    spec: {
                        joinConfiguration: {
                            nodeRegistration: {
                                kubeletExtraArgs: {
                                    "cloud-provider": "external",
                                    "provider-id": "equinixmetal://{{ `{{ v1.instance_id }}` }}",
                                },
                            },
                        },
                        preKubeadmCommands: [
                            `sed -ri '/\\sswap\\s/s/^#?/#/' /etc/fstab
                    swapoff -a
                    mount -a
                    cat <<EOF > /etc/modules-load.d/containerd.conf
                    overlay
                    br_netfilter
                    EOF
                    modprobe overlay
                    modprobe br_netfilter
                    cat <<EOF > /etc/sysctl.d/99-kubernetes-cri.conf
                    net.bridge.bridge-nf-call-iptables  = 1
                    net.ipv4.ip_forward                 = 1
                    net.bridge.bridge-nf-call-ip6tables = 1
                    EOF
                    sysctl --system
                    export DEBIAN_FRONTEND=noninteractive
                    apt-get update -y
                    apt-get remove -y docker docker-engine containerd runc
                    apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release linux-generic jq
                    install -m 0755 -d /etc/apt/keyrings
                    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
                    MINOR_KUBERNETES_VERSION=$(echo {{ .kubernetesVersion }} | cut -d. -f1-2 )
                    curl -fsSL https://pkgs.k8s.io/core:/stable:/$\{MINOR_KUBERNETES_VERSION\}/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
                    chmod a+r /etc/apt/keyrings/docker.gpg
                    chmod a+r /etc/apt/keyrings/kubernetes-archive-keyring.gpg
                    echo "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" > /etc/apt/sources.list.d/docker.list
                    echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/$\{MINOR_KUBERNETES_VERSION\}/deb/ /" > /etc/apt/sources.list.d/kubernetes.list
                    apt-get update -y
                    TRIMMED_KUBERNETES_VERSION=$(echo {{ .kubernetesVersion }} | sed 's/\\./\\\\\\\\./g' | sed 's/^v//')
                    RESOLVED_KUBERNETES_VERSION=$(apt-cache madison kubelet | awk -v VERSION=$\{TRIMMED_KUBERNETES_VERSION\} '$3~ VERSION { print $3 }' | head -n1)
                    apt-get install -y containerd.io kubelet=$\{RESOLVED_KUBERNETES_VERSION\} kubeadm=$\{RESOLVED_KUBERNETES_VERSION\} kubectl=$\{RESOLVED_KUBERNETES_VERSION\}
                    cat  <<EOF > /etc/crictl.yaml
                    runtime-endpoint: unix:///run/containerd/containerd.sock
                    image-endpoint: unix:///run/containerd/containerd.sock
                    EOF
                    containerd config default > /etc/containerd/config.toml
                    sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
                    sed -i "s,sandbox_image.*$,sandbox_image = \\"$(kubeadm config images list | grep pause | sort -r | head -n1)\\"," /etc/containerd/config.toml
                    systemctl restart containerd`
                        ],
                    },
                },
            },
        }, {parent: this});

        const cluster = new k8s.apiextensions.CustomResource(args.name, {
            apiVersion: "cluster.x-k8s.io/v1beta1",
            kind: "Cluster",
            metadata: {
                name: args.name,
                namespace: args.namespace,
            },
            spec: {
                clusterNetwork: {
                    pods: {
                        cidrBlocks: ["192.168.0.0/16"],
                    },
                    services: {
                        cidrBlocks: ["172.26.0.0/16"],
                    },
                },
                controlPlaneRef: {
                    apiVersion: "controlplane.cluster.x-k8s.io/v1beta1",
                    kind: "KubeadmControlPlane",
                    name: args.name + "-control-plane",
                },
                infrastructureRef: {
                    apiVersion: "infrastructure.cluster.x-k8s.io/v1beta1",
                    kind: "PacketCluster",
                    name: args.name,
                },
            },
        }, {parent: this});

// Define the MachineDeployment CustomResource
        const machineDeployment = new k8s.apiextensions.CustomResource(args.name+"-worker-a", {
            apiVersion: "cluster.x-k8s.io/v1beta1",
            kind: "MachineDeployment",
            metadata: {
                labels: {
                    "cluster.x-k8s.io/cluster-name": args.name,
                    pool: "worker-a",
                },
                name: args.name + "-worker-a",
                namespace: args.namespace,
            },
            spec: {
                clusterName: args.name,
                replicas: 1,
                selector: {
                    matchLabels: {
                        "cluster.x-k8s.io/cluster-name": args.name,
                        pool: "worker-a",
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "cluster.x-k8s.io/cluster-name": args.name,
                            pool: "worker-a",
                        },
                    },
                    spec: {
                        bootstrap: {
                            configRef: {
                                apiVersion: "bootstrap.cluster.x-k8s.io/v1beta1",
                                kind: "KubeadmConfigTemplate",
                                name: args.name + "-worker-a",
                            },
                        },
                        clusterName: args.name,
                        infrastructureRef: {
                            apiVersion: "infrastructure.cluster.x-k8s.io/v1beta1",
                            kind: "PacketMachineTemplate",
                            name: args.name + "-worker-a",
                        },
                        version: args.kubernetesVersion,
                    },
                },
            },
        }, {parent: this});

        const kubeadmControlPlane = new k8s.apiextensions.CustomResource(args.name+"-control-plane", {
            apiVersion: "controlplane.cluster.x-k8s.io/v1beta1",
            kind: "KubeadmControlPlane",
            metadata: {
                name: args.name + "-control-plane",
                namespace: args.namespace,
            },
            spec: {
                kubeadmConfigSpec: {
                    clusterConfiguration: {
                        apiServer: {
                            extraArgs: {
                                "cloud-provider": "external",
                            },
                        },
                        controllerManager: {
                            extraArgs: {
                                "cloud-provider": "external",
                            },
                        },
                    },
                    initConfiguration: {
                        nodeRegistration: {
                            kubeletExtraArgs: {
                                "cloud-provider": "external",
                                "provider-id": "equinixmetal://{{ `{{ v1.instance_id }}` }}",
                            },
                        },
                    },
                    joinConfiguration: {
                        nodeRegistration: {
                            ignorePreflightErrors: ["DirAvailable--etc-kubernetes-manifests"],
                            kubeletExtraArgs: {
                                "cloud-provider": "external",
                                "provider-id": "equinixmetal://{{ `{{ v1.instance_id }}` }}",
                            },
                        },
                    },
                    postKubeadmCommands: [
                        pulumi.interpolate`cat <<EOF >> /etc/network/interfaces
                auto lo:0
                iface lo:0 inet static
                  address {{ .controlPlaneEndpoint }}
                  netmask 255.255.255.255
                EOF
                systemctl restart networking
                mkdir -p $HOME/.kube
                cp /etc/kubernetes/admin.conf $HOME/.kube/config
                echo "source <(kubectl completion bash)" >> $HOME/.bashrc
                echo "alias k=kubectl" >> $HOME/.bashrc
                echo "complete -o default -F __start_kubectl k" >> $HOME/.bashrc
                if [ -f "/run/kubeadm/kubeadm.yaml" ]; then
                    export KUBECONFIG=/etc/kubernetes/admin.conf
                    export CPEM_YAML=https://github.com/equinix/cloud-provider-equinix-metal/releases/download/v3.7.0/deployment.yaml
                    export SECRET_DATA='cloud-sa.json=''{"apiKey": "{{ .apiKey }}","projectID": "3fa7f960-01ef-4f43-adef-7c743d978de6", "eipTag": "cluster-api-provider-packet:cluster-id:${args.name}", "eipHealthCheckUseHostIP": true}'''
                    kubectl create secret generic -n kube-system metal-cloud-config --from-literal="$/{SECRET_DATA/}" || (sleep 1 && kubectl create secret generic -n kube-system metal-cloud-config --from-literal="$/{SECRET_DATA/}") || (sleep 1 && kubectl create secret generic -n kube-system metal-cloud-config --from-literal="$/{SECRET_DATA/}")
                    kubectl apply -f $/{CPEM_YAML/} || (sleep 1 && kubectl apply -f $/{CPEM_YAML/}) || (sleep 1 && kubectl apply -f $/{CPEM_YAML/})
                fi`,
                    ],
                    preKubeadmCommands: [
                        `sed -ri '/\\sswap\\s/s/^#?/#/' /etc/fstab
                swapoff -a
                mount -a
                cat <<EOF > /etc/modules-load.d/containerd.conf
                overlay
                br_netfilter
                EOF
                modprobe overlay
                modprobe br_netfilter
                cat <<EOF > /etc/sysctl.d/99-kubernetes-cri.conf
                net.bridge.bridge-nf-call-iptables  = 1
                net.ipv4.ip_forward                 = 1
                net.bridge.bridge-nf-call-ip6tables = 1
                EOF
                sysctl --system
                export DEBIAN_FRONTEND=noninteractive
                apt-get update -y
                apt-get remove -y docker docker-engine containerd runc
                apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release linux-generic jq
                major_vers=$(lsb_release -r | awk '{ print $2 }' | cut -d. -f1)
                if [ "$major_vers" -ge 20 ]; then
                    apt-get install -y kubetail
                fi
                install -m 0755 -d /etc/apt/keyrings
                curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
                MINOR_KUBERNETES_VERSION=$(echo {{ .kubernetesVersion }} | cut -d. -f1-2 )
                curl -fsSL https://pkgs.k8s.io/core:/stable:/$/{MINOR_KUBERNETES_VERSION/}/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
                chmod a+r /etc/apt/keyrings/docker.gpg
                chmod a+r /etc/apt/keyrings/kubernetes-archive-keyring.gpg
                echo "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" > /etc/apt/sources.list.d/docker.list
                echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/$/{MINOR_KUBERNETES_VERSION/}/deb/ /" > /etc/apt/sources.list.d/kubernetes.list
                apt-get update -y
                TRIMMED_KUBERNETES_VERSION=$(echo {{ .kubernetesVersion }} | sed 's/\\./\\\\./g' | sed 's/^v//')
                RESOLVED_KUBERNETES_VERSION=$(apt-cache madison kubelet | awk -v VERSION=$/{TRIMMED_KUBERNETES_VERSION/} '$3~ VERSION { print $3 }' | head -n1)
                apt-get install -y containerd.io kubelet=$/{RESOLVED_KUBERNETES_VERSION/} kubeadm=$/{RESOLVED_KUBERNETES_VERSION/} kubectl=$/{RESOLVED_KUBERNETES_VERSION/}
                containerd config default > /etc/containerd/config.toml
                cat  <<EOF > /etc/crictl.yaml
                runtime-endpoint: unix:///run/containerd/containerd.sock
                image-endpoint: unix:///run/containerd/containerd.sock
                EOF
                sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
                sed -i "s,sandbox_image.*$,sandbox_image = \"$(kubeadm config images list | grep pause | sort -r | head -n1)\"," /etc/containerd/config.toml
                systemctl restart containerd
                ping -c 3 -q {{ .controlPlaneEndpoint }} && echo OK || ip addr add {{ .controlPlaneEndpoint }} dev lo`,
                    ],
                },
                machineTemplate: {
                    infrastructureRef: {
                        apiVersion: "infrastructure.cluster.x-k8s.io/v1beta1",
                        kind: "PacketMachineTemplate",
                        name: args.name + "-control-plane",
                    },
                },
                replicas: args.numberOfControlPlaneNodes,
                version: args.kubernetesVersion,
            },
        }, {parent: this});

// Define the PacketCluster CustomResource
        const packetCluster = new k8s.apiextensions.CustomResource(args.name, {
            apiVersion: "infrastructure.cluster.x-k8s.io/v1beta1",
            kind: "PacketCluster",
            metadata: {
                name: args.name,
                namespace: args.namespace,
            },
            spec: {
                metro: args.metro,
                projectID: args.projectID,
                vipManager: "CPEM",
            },
        }, {parent: this});

// Define the PacketMachineTemplate for control plane
        const controlPlaneMachineTemplate = new k8s.apiextensions.CustomResource(args.name+"-control-plane", {
            apiVersion: "infrastructure.cluster.x-k8s.io/v1beta1",
            kind: "PacketMachineTemplate",
            metadata: {
                name: args.name + "-control-plane",
                namespace: args.namespace,
            },
            spec: {
                template: {
                    spec: {
                        billingCycle: "hourly",
                        machineType: args.machineType,
                        os: args.os,
                        sshKeys: [
                            args.sshKey,
                        ],
                        tags: []
                    },
                },
            },
        }, {parent: this});

        const workerMachineTemplate = new k8s.apiextensions.CustomResource(args.name+"-worker-a", {
            apiVersion: "infrastructure.cluster.x-k8s.io/v1beta1",
            kind: "PacketMachineTemplate",
            metadata: {
                name: args.name + "-worker-a",
                namespace: args.namespace,
            },
            spec: {
                template: {
                    spec: {
                        billingCycle: "hourly",
                        machineType: args.machineType,
                        os: args.os,
                        sshKeys: [
                            args.sshKey,
                        ],
                        tags: []
                    }
                }
            }
        }, {parent: this});

        this.name = args.name;
        this.registerOutputs({
            name: this.name,
        });
    }
}
