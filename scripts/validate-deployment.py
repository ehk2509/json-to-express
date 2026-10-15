#!/usr/bin/env python3
"""Local generated Kubernetes manifest consistency checks; no cluster implied."""
import os
import sys
import yaml


class UniqueKeysLoader(yaml.SafeLoader):
    pass


def construct_mapping(loader, node):
    loader.flatten_mapping(node)
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=True)
        if key in result:
            raise ValueError(f"Duplicate Kubernetes YAML key: {key}")
        result[key] = loader.construct_object(value_node, deep=True)
    return result


UniqueKeysLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, construct_mapping
)


def load(base, filename):
    with open(os.path.join(base, filename), encoding="utf-8") as handle:
        value = yaml.load(handle, Loader=UniqueKeysLoader)
    assert isinstance(value, dict), f"{filename} must be a YAML object"
    assert value.get("apiVersion") and value.get("kind"), filename
    assert value.get("metadata", {}).get("name"), filename
    return value


def verify(base):
    deployment = load(base, "deployment.yaml")
    service = load(base, "service.yaml")
    config = load(base, "configmap.yaml")
    secrets = load(base, "secret.example.yaml")
    assert deployment["kind"] == "Deployment"
    assert deployment["apiVersion"] == "apps/v1"
    assert service["kind"] == "Service"
    assert config["kind"] == "ConfigMap"
    assert secrets["kind"] == "Secret"
    assert deployment["spec"]["replicas"] > 0
    template = deployment["spec"]["template"]
    labels = template["metadata"]["labels"]
    selector = deployment["spec"]["selector"]["matchLabels"]
    assert all(labels.get(key) == val for key, val in selector.items())
    assert all(labels.get(key) == val
               for key, val in service["spec"]["selector"].items())
    containers = template["spec"]["containers"]
    assert containers and all(container.get("image") for container in containers)
    assert containers[0]["ports"][0]["name"] == "http"
    assert containers[0]["readinessProbe"]["httpGet"]["port"] == "http"
    assert containers[0]["livenessProbe"]["httpGet"]["port"] == "http"
    env_refs = containers[0]["envFrom"]
    config_name = config["metadata"]["name"]
    secret_name = secrets["metadata"]["name"]
    assert any(item.get("configMapRef", {}).get("name") == config_name
               for item in env_refs)
    assert any(item.get("secretRef", {}).get("name") == secret_name
               for item in env_refs)
    port = service["spec"]["ports"][0]
    assert port["targetPort"] == "http" and port["port"] > 0
    assert secrets.get("stringData") is not None
    assert config.get("data") is not None


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: validate-deployment.py <kubernetes-dir>")
    verify(sys.argv[1])
    print("PASS generated Kubernetes YAML structure and cross-resource references")
