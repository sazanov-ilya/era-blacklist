import { DataFactory } from "./era/data/model";
import { RestDataFactory } from "./era/data/core";
import { EraApplication, LogManager } from "./era/utils";
import { EraEnvironment, EraLowLevel } from "./lowlevel";
import { PlatformServices } from "./era/platform/core";
import BuilderServices from "./era/builder/services/BuilderServices";
import MainService from "./era/blacklist/services/MainService";

EraApplication.initialize();

var args = process.argv[3];
LogManager.default.core("Parameters: " + args);
try {
    var parsed = JSON.parse(args);
    EraEnvironment.domain = parsed.domain;
    EraEnvironment.serverName = parsed.servername;
    EraEnvironment.http_servers = parsed.http_servers ?? [];
    EraEnvironment.http_servers_ex = parsed.http_servers_ex ?? {};
    EraEnvironment.token = parsed.token;
    EraEnvironment.logpath = parsed.logpath ?? "/tmp/era/logs/";
    if (!EraEnvironment.logpath.endsWith("/"))
        EraEnvironment.logpath += "/";
    LogManager.logPath = EraEnvironment.logpath;
}
catch (e) {
    LogManager.default.core("Could not process parameters", e);
}
if (process.argv[1]?.endsWith(".ts")) {
    EraLowLevel.isDeveloper = true;
}
EraEnvironment.initializeServer();
LogManager.default.core("Init: RestDataFactory...");
DataFactory.Initialize(new RestDataFactory()).then(async () => {
    if (DataFactory.sessionInfo.domain !== EraEnvironment.domain) {
        throw `Session info domain ${DataFactory.sessionInfo.domain} is incompatible with command line ${EraEnvironment.domain}`;
    }
    LogManager.default.core("Init: BuilderServices...");
    await BuilderServices.startCommonServices();
    LogManager.default.core("Init: PlatformServices...");
    await PlatformServices.startServerServices();
    LogManager.default.core("Init: MainService...");
    new MainService();
    LogManager.default.core(`Init: finished isServer=${EraEnvironment.isServer} isClient=${EraEnvironment.isClient}`);
    
}).catch((e) => {
    LogManager.default.exception("Error in service initialize", e);
    EraLowLevel.fatalError("Service MainService initialization failed");
    
});