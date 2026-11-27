import ballerina/graphql;

type Book record {|
    string title;
|};

type BookNotFound distinct error;

type BookOrError Book|error;

service class Shelf {
    resource function get book() returns Book|error {
        return {title: ""};
    }

    resource function get label() returns string {
        return "";
    }
}

service /books on new graphql:Listener(9096) {

    resource function get book() returns Book|error {
        return {title: ""};
    }

    resource function get maybeBook() returns Book|error? {
        return ();
    }

    resource function get books() returns Book[]|error {
        return [];
    }

    resource function get byTitle(string title) returns Book|BookNotFound {
        return {title};
    }

    resource function get aliased() returns BookOrError {
        return {title: ""};
    }

    resource function get plain() returns Book {
        return {title: ""};
    }

    resource function get shelf() returns Shelf {
        return new;
    }

    remote function addBook(string title) returns Book|error {
        return {title};
    }

    resource function subscribe endsWithError() returns stream<Book, error?> {
        return [].toStream();
    }

    resource function subscribe newBooks() returns stream<Book> {
        return [].toStream();
    }
}
