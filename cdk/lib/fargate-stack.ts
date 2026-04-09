import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { Construct } from 'constructs'

interface Props extends cdk.StackProps {
  dbInstance: rds.DatabaseInstance
  vpc: ec2.Vpc
}

export class FargateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    const mtaSecret = new secretsmanager.Secret(this, 'MtaApiKey', {
      secretName: 'subway-intel/mta-api-key',
      description: 'MTA GTFS-RT API key',
    })

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc: props.vpc })

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('..', {
          file: 'backend/Dockerfile',
          exclude: ['cdk', 'cdk.out', 'frontend', 'docs', '**/__pycache__', '**/*.pyc'],
        }),
        containerPort: 8000,
        environment: { GTFS_POLL_INTERVAL_SEC: '30' },
        secrets: {
          MTA_API_KEY: ecs.Secret.fromSecretsManager(mtaSecret),
          DATABASE_URL: ecs.Secret.fromSecretsManager(
            props.dbInstance.secret!, 'DATABASE_URL'
          ),
        },
      },
      publicLoadBalancer: true,
    })

    // Allow Fargate tasks to reach RDS on 5432 (using VPC CIDR to avoid cross-stack cyclic ref)
    props.dbInstance.connections.allowFrom(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Fargate tasks in VPC'
    )

    new cdk.CfnOutput(this, 'ServiceUrl', { value: service.loadBalancer.loadBalancerDnsName })
  }
}
