import { GlobalUtils, Converter, EBaseLogLevel } from "./../../utils";
import { Service } from "./../../platform/core";
import { IRootUser, IRootUsers } from "../../root/model";
import { RootUsers } from "../../root/classes";
import { BlacklistRecommendeds, BlackLists, BlackListTypes } from "../classes";
import { IBlackList, IBlacklistRecommendeds, IBlackLists, IBlackListType, IBlackListTypes } from "../model";

import { EUpdateKind, IBaseEntity, IDataUpdateParams, IHistoryLink } from "../../base/model";
import { DataFactory, FilterBuilder } from "../../data/model";
import { IInvocation } from "../../platform/model";

class MainService extends Service {
    constructor() {
        super("blacklist.MainService");

        // onCreateCode

        // 2. На время разработки дублируем в консоль все, 
        // что пишется в лог до уровня debug
        // Настравается в приложении "Админ платформы" (поиск по имени пакета)
        // по возрастанию степени детализаии:
        // core
        // error
        // warning
        // info
        // trace
        // debug
        this.log.consoleLevel = EBaseLogLevel.debug;


        // Классы ТОЛЬКО для отслеживания изменения и добавления новых записей
        // (списки loadAll через них не получаем)
        this._blackListTypes = new BlackListTypes(this.context);

        this._blacklists = new BlackLists(this.context);
        this._blacklists.onAfterUpdate(this.afterUpdateBlackLists.bind(this));

        this._blacklistRecommendeds = new BlacklistRecommendeds(this.context);
        this._blacklistRecommendeds.onAfterUpdate(this.afterUpdateBlacklistRecommendeds.bind(this));


        // Дата/время для часового таймера
        // (обновляется каждый час)
        this._hourInterval = GlobalUtils.nowTimeStamp();


        this.load();
    }

    private _blackListTypes: IBlackListTypes;               // Тип ЧС
    private _blacklists: IBlackLists;                       // ЧС
    private _blacklistRecommendeds: IBlacklistRecommendeds; // Рекомендуется для ЧС

    private _hourInterval: number;

    async onInit() {
        await super.onInit();
        try {

            // onInitCode

            // 1. Вывод сообщения о запуске
            const message_init: string = '### blacklist.MainServise.ts -> onInit';
            //console.log(message_init);          
            this.log.info(message_init);

        }
        catch (e) {
            this.log.exception("onInit", e);
        }
    }


    async onTimer() {
        await super.onTimer();
        try {

            // onTimerCode


            const now = GlobalUtils.nowTimeStamp();
            const oneHour = 3600000; // 1 час в миллисекундах
            //const oneHour = 60000; // 1 минута

            // Прошел 1 час?
            if (now - this._hourInterval > oneHour) {

                //this.log.debug("onTimer -> this.startTime", this.startTime);

                this.deleteTempPhonesFromBlacklist();             // Удаление временных номеров
                this._hourInterval = GlobalUtils.nowTimeStamp();  // Переопределение времени
            }
        }
        catch (e) {
            this.log.exception("onTimer", e);
        }
    }


    // Мониторинг добавления/обновления "ЧС"
    async afterUpdateBlackLists(params_: IDataUpdateParams<IBaseEntity>) {
        //this.log.debug('afterUpdateBlacklists -> params_:\n', params_);

        try {
            // Добавление или обновление
            if (params_.updateKind === EUpdateKind.Insert || params_.updateKind === EUpdateKind.Modify) {
                //this.log.debug('afterUpdateBlacklists, params_:', params_);

                // Параметры
                const modifierId = params_.modifier_id;
                const phone = params_.entity?.getValue('phone');

                // Данные сессии
                const session = DataFactory.sessionInfo;
                //this.log.debug('afterUpdateBlacklists -> sessionInfo:\n', session);

                // Ключа integration_point_id нет в явном виде, 
                // получаем значение через приведение к JSON
                const integrationPointId = JSON.parse(JSON.stringify(session)).integration_point_id;
                //this.log.debug('#integrationPointId: ', integrationPointId);

                if (modifierId !== integrationPointId) {
                    // При добавлении нового номера получаем insert, обновляем пользователя
                    // и получаем modify (который нужно игнорировать)
                    this.log.debug('afterUpdateBlacklists, params_:\n', params_);

                    // 1. Обновляем пользователя "ЧС"
                    //const user = await this._users.getByID(modifierId);
                    const user = await this.getUser(modifierId);
                    const blacklist = await this._blacklists.getByIDStrong(params_.id);
                    blacklist.user = user;

                    // 2. Проверяем и закрываем в "Рекомендовано для ЧС"
                    await this.closeInRecommended(phone);
                } // if (modifierId
            } // if (params_.updateKind
        }
        catch (e) {
            this.log.exception('afterUpdateBlacklists', e);
        }
    }


    // Мониторинг добавления/обновления "Рекомендовано для ЧС"
    async afterUpdateBlacklistRecommendeds(params_: IDataUpdateParams<IBaseEntity>) {
        //this.log.debug('afterUpdateBlacklistRecommendeds -> params_:\n', params_);

        try {
            // Добавление И обновлене
            if (params_.updateKind === EUpdateKind.Insert || params_.updateKind === EUpdateKind.Modify) {
                //this.log.debug('afterUpdateRecommendedBls, params_:\n', params_);

                // Параметры
                const modifierId = params_.modifier_id;
                const phone = params_.entity?.getValue('phone');

                // Данные сессии
                const session = DataFactory.sessionInfo;
                //this.log.debug('sessionInfo: ', session);

                // Ключа integration_point_id нет в явном виде,
                // получаем значение через приведение к JSON
                const integrationPointId = JSON.parse(JSON.stringify(session)).integration_point_id;
                //this.log.debug('#integrationPointId: ', integrationPointId);

                if (modifierId !== integrationPointId) {
                    //this.log.debug('afterUpdateRecommendedBls, params_:\n', params_);

                    // 1. Обновление пользователя
                    const user = await this.getUser(modifierId);
                    const blacklistRecommendeds = await this._blacklistRecommendeds.getByIDStrong(params_.id);
                    blacklistRecommendeds.user = user;

                    // 2. Если номер уже в ЧС, то закрываем как обработанный
                    const existsBlacklist = await this.checkPhoneByBlacklist(phone);
                    if (existsBlacklist) {
                        // 2.1. Проверяем и ТОЛЬКО закрываем в "Рекомендовано для ЧС"
                        await this.closeInRecommended(phone, 'Номер уже в ЧС');
                    }
                    else {
                        // 3. Проверка числа рекомендаций для добавления в ЧС
                        const countRecommendeds = await this.getCountRecommendeds(phone)
                        this.log.debug('afterUpdateBlacklistRecommendeds ->  countRecommendeds: ', countRecommendeds);

                        if (countRecommendeds >= 5) {
                            // 3.1. ПРОВЕРЯЕМ тип ЧС
                            const code: string = 'by_count_recommends'
                            if (await this.checkExistBlacklistType(code)) { // Если есть тип ЧС
                                // Добавляем в ЧС
                                await this.addToBlacklist_tst(phone, code, modifierId, 'Добавлен в ЧС по числу рекомендаций')
                                //await this.closeInRecommended(phone);
                            } else { // Если нет типа ЧС
                                const name = 'По числу рекомендаций';
                                const isPermanent = false;
                                const blockTime = 86400 // 1 день
                                // Добавляем тип ЧС и ЧС
                                await this.addToBlackListType(code, name, isPermanent, blockTime)
                                await this.addToBlacklist_tst(phone, code, modifierId, 'Добавлен в ЧС по числу рекомендаций')
                                //await this.closeInRecommended(phone);
                            }
                        }
                    }
                }
            }
        }
        catch (e) {
            this.log.exception('afterUpdateBlacklists', e);
        }
    }


    // Процедура -> получение пользователя
    async getUser(userId: string | undefined) {
        //this.log.debug('getUser -> userId', userId);

        try {
            let usersTmp: IRootUsers = new RootUsers(this.context);
            let user: IRootUser | undefined = undefined

            // Ищем пользователя в БД, если он есть
            let filter = FilterBuilder.equals('id', userId);
            const users = await usersTmp.loadAll({ select: { filter } });
            if (users.length > 0) {
                user = users[0]
            }
            //this.log.debug('getUser -> user:\n', user);

            return user;
        }
        catch (e) {
            this.log.exception('getUser -> exception', e);
        }
    }


    // Процедура -> получение объекта "Тип ЧС"
    async getBlacklistType(type_code: string): Promise<IBlackListType | undefined> {
        //this.log.debug('getBlacklistType');

        try {
            const blackListTypesTmp = new BlackListTypes(this.context);
            const filter = FilterBuilder.equals('code', type_code);
            const blacklistTypes = await blackListTypesTmp.loadAll({ select: { filter } });

            return blacklistTypes[0];
        }
        catch (e) {
            this.log.exception('getBlacklistType', e);
        }
    }

    // Процедура -> проверка существования типа ЧС
    async checkExistBlacklistType(type_code: string): Promise<boolean> {
        this.log.debug('checkExistBlacklistType -> params', { type_code });

        try {
            const blacklistType = await this.getBlacklistType(type_code);

            return !!blacklistType; // Преобразуем в boolean

        } catch (e) {
            this.log.exception('checkExistBlacklistType -> exception', e);
            return false; // Возвращаем false в случае ошибки
        }
    }


    // Процедура -> помечает "Рекомендованно для ЧС" как обработанные
    async closeInRecommended(phone: string, comment?: string) {
        //this.log.debug('closeInRecommended -> params', { phone, comment });

        try {
            if (phone.trim().length > 0) { // Если есть номер
                let blacklistRecommendedsTmp = new BlacklistRecommendeds(this.context);
                let filter = FilterBuilder.and(FilterBuilder.equals("phone", phone), FilterBuilder.equals("isAdded", false));
                const blacklistRecommendeds = await blacklistRecommendedsTmp.loadAll({ select: { filter } });
                //this.log.debug('closeInRecommended -> blacklistRecommendeds', blacklistRecommendeds);

                if (blacklistRecommendeds.length > 0) { // Закрываем все что есть
                    //this.log.debug('closeInRecommended -> закрываем все рекомендации для', { phone });
                    for (let blacklistRecommended_ of blacklistRecommendeds) {
                        blacklistRecommended_.isAdded = true;
                        if (comment) { // Добавляем новый комментарий к текущему
                            blacklistRecommended_.comment = blacklistRecommended_.comment
                                ? blacklistRecommended_.comment + ' -> ' + comment
                                : ' -> ' + comment;
                        }
                    }
                }
            }
        }
        catch (e) {
            this.log.exception('closeInRecommended -> exception', e);
        }
    }


    // Процедура -> проверка номера телефона по ЧС (true/false)
    async checkPhoneByBlacklist(phone: string): Promise<boolean> {
        //this.log.debug('checkPhoneByBlacklist -> phone: ', phone);

        try {
            //if (phone.trim().length > 0) { // Если есть номер
            if (typeof phone === 'string' && phone.trim().length > 0) { // Если есть номер
                // Создаем отдельный объект ЧС
                let blacklistsTmp = new BlackLists(this.context);
                let filter = FilterBuilder.equals("phone", phone);
                const blacklists = await blacklistsTmp.loadAll({ select: { filter } });

                if (blacklists.length > 0) {
                    // ...
                    return true;  // ЕСТЬ В ЧС
                }
            }

            return false;  // НЕТ В ЧС

        } catch (e) {
            this.log.exception('checkPhoneByBlacklist -> exception', e);
            // Возврат false (или вернуть исключение)
            return false;  // НЕТ В ЧС
        }
    }


    // Процедура -> добавление нового типа ЧС
    async addToBlackListType(code: string, name: string, is_permanent: boolean, block_time: number) {
        //this.log.debug('addToBlacklist -> params', { code, name, is_permanent, block_time })

        try {
            // Создаем тип ЧС
            await this._blackListTypes.addNew(blacklistType_ => {
                blacklistType_.code = code;
                blacklistType_.name = name;
                blacklistType_.isPermanent = is_permanent;
                blacklistType_.blockTime = block_time;
            });
        }
        catch (e) {
            this.log.exception('getBlacklistTypeDefault', e);
        }
    }


    // Процедура -> возвращает число рекомендаций для добавления в ЧС
    async getCountRecommendeds(phone: string): Promise<number> {
        //this.log.debug('getCountRecommendeds -> phone: ', phone);

        try {
            if (typeof phone === 'string' && phone.trim().length > 0) { // Если есть номер
                let blacklistRecommendedsTmp = new BlacklistRecommendeds(this.context);
                let filter = FilterBuilder.and(FilterBuilder.equals("phone", phone), FilterBuilder.equals("isAdded", false));
                const blacklistRecommendeds = await blacklistRecommendedsTmp.loadAll({ select: { filter } });

                if (blacklistRecommendeds.length > 0) {
                    return blacklistRecommendeds.length;  // ...
                }
            }

            return 0;  // ...

        } catch (e) {
            this.log.exception('getCountRecommendeds -> exception', e);
            // Возврат 0 (или вернуть исключение)
            return 0;  // ...
        }
    }


    //Поцедура -> возврат признак ЧС при вызове из сценария
    async checkPhoneByBlacklist_exec(invocation_: IInvocation) {
        //this.log.debug('checkPhoneByBlacklist_exec -> invocation_', invocation_);

        try {
            //const result = await this.checkPhoneByBlacklist(invocation_.request?.getValue('phone'));
            const result = await this.checkPhoneByBlacklist(invocation_.request?.phone.toString());

            return {
                result
            };
        }
        catch (e) {
            this.log.exception('checkPhoneByBlacklist_exec -> exception', e);

            return false;
        }
    }


    // Процедура -> добавляет новый номер в "Рекомендовать для ЧС"
    async addToBlacklistRecommended(seance_id: string, phone: string, user_id: string | undefined, comment: string) {
        //this.log.debug('addToBlacklist -> params', { phone, type_code, user_id, comment })

        try {
            let user: IRootUser | undefined;  // Пользователь
            [user] = await Promise.all([      // Ускоряем через параллельный вызов
                this.getUser(user_id)
            ]);

            // 1. Проверка на обязательные параметры
            if (phone.trim().length === 0 || !user) {
                this.log.exception('addToBlacklistRecommended -> нет ключевых параметров', JSON.stringify({
                    phone,
                    user_id,
                    comment,
                    user: !!user
                }));
                return; // ОБРЫВАЕМ, если не достаточно парметров
            } else {
                //this.log.debug('...', ...)
            }

            // 2. Добавление в "Рекомендовать для ЧС"
            await this._blacklistRecommendeds.addNew(blacklistRecommended_ => { // Добавление ...
                blacklistRecommended_.seanceId = seance_id;
                blacklistRecommended_.insertDttm = new Date();
                blacklistRecommended_.phone = phone;
                blacklistRecommended_.user = user;
                blacklistRecommended_.comment = comment;
            });
        }
        catch (e) {
            this.log.exception('addToBlacklist', e);
        }
    }


    // Процедура -> кнопки "Рекомендовать для ЧС"
    async buttonAddToBlacklistRecommended(invocation_: IInvocation) {
        this.log.debug('buttonAddToBlacklistRecommended -> invocation_', invocation_);

        try {
            const { parameters, user_id } = invocation_.request?.request || {};
            const { seance_id, phone, comment } = parameters || {};

            await this.addToBlacklistRecommended(seance_id, phone, user_id, comment)

            return true;
        }
        catch (e) {
            this.log.exception('buttonAddToBlacklistRecommended', e);

            return false;
        }
    }


    // Процедура -> добавляет новый номер в "ЧС"
    async addToBlacklist_tst(phone: string, type_code: string, user_id: string | undefined, comment: string) {
        //this.log.debug('addToBlacklist -> params', { phone, type_code, user_id, comment })

        try {
            let blacklistType: IBlackListType | undefined; // Тип ЧС 
            let user: IRootUser | undefined;               // Пользователь
            [blacklistType, user] = await Promise.all([    // Ускоряем через параллельный вызов
                this.getBlacklistType(type_code),
                this.getUser(user_id)
            ]);

            // 1. Проверка на обязательные параметры
            if (phone.trim().length === 0 || !blacklistType || !user) {
                this.log.exception('addToBlacklist -> нет ключевых параметров', JSON.stringify({
                    phone,
                    type_code,
                    user_id,
                    comment,
                    blacklistType: !!blacklistType,
                    user: !!user
                }));
                return; // ОБРЫВАЕМ,если не достаточно парметров
            } else {
                //this.log.debug('...', ...)
            }

            // 2. Проверка по ЧС и добавление в ЧС
            const existsBlacklist = await this.checkPhoneByBlacklist(phone);

            if (!existsBlacklist) {                           // Если номера НЕТ в ЧС
                await this._blacklists.addNew(blacklist_ => { // Добавление в ЧС
                    blacklist_.insertDttm = new Date();
                    blacklist_.type = blacklistType!; // Утверждаем, что blacklistType не undefined
                    blacklist_.phone = phone;
                    blacklist_.user = user;
                    blacklist_.comment = comment;
                });
            }
            //// Закрываем в "Рекомендованно для ЧС"
            ////await this.closeInRecommended(phone, comment ? comment : undefined);
            await this.closeInRecommended(phone);
        }
        catch (e) {
            this.log.exception('addToBlacklist', e);
        }
    }


    // Процедура -> кнопки "Добавить в ЧС"
    async buttonAddToBlacklist(invocation_: IInvocation) {
        //this.log.debug('buttonAddToBlacklist -> invocation_', invocation_);

        try {
            const { parameters, user_id } = invocation_.request?.request || {};
            const { phone, type: type_code, comment } = parameters || {};

            // Добавляем в ЧС
            await this.addToBlacklist_tst(phone, type_code, user_id, comment)

            return true;
        }
        catch (e) {
            this.log.exception('buttonAddToBlacklist', e);

            return false;
        }
    }


    // Процедура -> удаление временных номеров из ЧС
    async deleteTempPhonesFromBlacklist() {
        this.log.debug('deleteTempPhonesFromBlacklist');

        try {
            // Список временных типов ЧС (isPermanent = false)
            let backListTypesTmp = new BlackListTypes(this.context);
            var filter = FilterBuilder.equals("isPermanent", false); // Временные номера
            const backListTypes = await backListTypesTmp.loadAll({ select: { filter } });
            this.log.debug('deleteTempPhonesFromBlacklist -> backListTypes', backListTypes);

            if (backListTypes.length > 0) {
                // Список кодов временных типов ЧС
                const codes = backListTypes.map(item => item.code); // список
                //const codes: string = backListTypes.map(item => item.code).join(', '); // строка
                this.log.debug('deleteTempPhonesFromBlacklist -> codes', codes);

                // Список временных номеров ЧС
                const propertyName = 'type_code'
                var filter: any = filterIN(propertyName, codes); // Фильтр
                this.log.debug('deleteTempPhonesFromBlacklist -> filter', filter);

                const blackListsTmp = new BlackLists(this.context);
                const blackLists = await blackListsTmp.loadAll({ select: { filter } });
                //this.log.debug('deleteTempPhonesFromBlacklist -> blackLists', blackLists);

                const currentTime = Date.now();              // Текущее время в миллисекундах            
                const toDelete = blackLists.filter(item => { // Список номеров на удаление
                    const insertTime = new Date(item.insertDttm).getTime(); // TimeStamp из insertDttm
                    const differenceSS = (currentTime - insertTime) / 1000; // Разница во времени в секундах
                    const blockTime = backListTypes.find(type => type.code === item.type_code)?.blockTime;
                    /*
                    this.log.debug('deleteTempPhonesFromBlacklist -> ', {
                        insertDttm: item.insertDttm,
                        type_code: item.type_code,
                        phone: item.phone,
                        differenceSS,
                        blockTime
                    });
                    */

                    return differenceSS >= (blockTime || 0); // Условие для удаления
                });

                // Удаление временных номеров
                for (const item of toDelete) {
                    await this._blacklists.deleteByID(item.id);
                }

                this.log.debug('\n-----');
                this.log.debug('toDelete: ', toDelete);
            }
            //await this._blacklists.deleteByID
        }
        catch (e) {
            this.log.exception('deleteTempPhonesFromBlacklist', e);
        }
    }



    // declarationsCode

    // functionsCode


}

// ...

function filterIN(propertyName_: string, propertyValues_: string[]): any[] {
    // Начинаем с массива "or"
    const filter: any[] = ["or"];

    // Проходим по всем значениям в propertyValues_
    for (const value of propertyValues_) {
        // Добавляем условие в нужном формате
        filter.push([
            "==",
            [
                "property",
                propertyName_
            ],
            [
                "const",
                value
            ]
        ]);
    }

    return filter;
}


export default MainService;
