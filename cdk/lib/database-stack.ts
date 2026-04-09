import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import { Construct } from 'constructs'

export class DatabaseStack extends cdk.Stack {
  public readonly instance: rds.DatabaseInstance
  public readonly vpc: ec2.Vpc

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props)

    this.vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2, natGateways: 1 })

    // RDS Postgres (TimescaleDB installed via init script post-deploy)
    this.instance = new rds.DatabaseInstance(this, 'SubwayDB', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      databaseName: 'subway_intel',
      credentials: rds.Credentials.fromGeneratedSecret('subway'),
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,  // personal project
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    })

    new cdk.CfnOutput(this, 'DbEndpoint', { value: this.instance.instanceEndpoint.hostname })
  }
}
